// Faz a mesma função servir na Vercel e na Netlify.
//
// As duas chamam a função de jeitos diferentes:
//
//   Netlify (Functions v2)  handler(request, context) -> Response
//   Vercel  (runtime Node)  handler(req, res)         -> escreve em `res`
//
// As funções deste projeto são escritas no primeiro formato, que é o padrão da
// web e o mais fácil de testar. Sem este adaptador, na Vercel elas quebravam na
// primeira linha que chamava `request.headers.get(...)` — `req.headers`, no
// Node, é um objeto simples e não tem `.get`. O erro caía no try/catch, a
// função devolvia um `Response` que a Vercel ignora, e a resposta nunca era
// escrita: o pedido ficava pendurado até o timeout, sem mensagem nenhuma.
//
// Envolvendo o handler com `universal()`, o mesmo código atende aos dois.

/**
 * O corpo do pedido, como texto.
 *
 * A Vercel já lê e interpreta o corpo antes de chamar a função quando o
 * content-type é conhecido — nesse caso o fluxo já foi consumido e só resta o
 * `req.body` pronto. Ler o fluxo nessa situação devolveria vazio, e o webhook
 * perderia o id do pagamento.
 */
async function corpoDoPedido(req) {
  if (req.body !== undefined && req.body !== null && req.body !== "") {
    if (typeof req.body === "string") return req.body;
    if (Buffer.isBuffer(req.body)) return req.body.toString("utf8");
    if (typeof req.body === "object") return JSON.stringify(req.body);
  }
  const partes = [];
  for await (const parte of req) partes.push(parte);
  return Buffer.concat(partes.map(p => Buffer.from(p))).toString("utf8");
}

/** Os cabeçalhos do Node no formato da web, descartando o que não é texto. */
function cabecalhos(brutos) {
  const h = new Headers();
  for (const [nome, valor] of Object.entries(brutos || {})) {
    if (valor == null) continue;
    for (const v of Array.isArray(valor) ? valor : [valor]) h.append(nome, String(v));
  }
  return h;
}

export function universal(handler) {
  return async function (a, b) {
    // Netlify passa (Request, context); a Vercel passa (req, res). Só a
    // resposta do Node tem `setHeader`, e é o que separa os dois casos.
    if (!b || typeof b.setHeader !== "function") return handler(a, b);

    const req = a, res = b;
    try {
      const host = req.headers["x-forwarded-host"] || req.headers.host || "local";
      const esquema = req.headers["x-forwarded-proto"] || "https";
      const url = esquema + "://" + host + (req.url || "/");
      const semCorpo = req.method === "GET" || req.method === "HEAD";

      const request = new Request(url, {
        method: req.method,
        headers: cabecalhos(req.headers),
        body: semCorpo ? undefined : await corpoDoPedido(req)
      });

      const resposta = await handler(request);
      res.statusCode = resposta.status;
      resposta.headers.forEach((valor, nome) => res.setHeader(nome, valor));
      res.end(Buffer.from(await resposta.arrayBuffer()));
    } catch (erro) {
      // Última rede de proteção: melhor um 500 explícito do que um pedido
      // pendurado, que é justamente o sintoma que este arquivo veio corrigir.
      console.error("adaptador", erro);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("content-type", "application/json; charset=utf-8");
      }
      res.end(JSON.stringify({ error: "Falha ao processar o pedido." }));
    }
  };
}
