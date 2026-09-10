/* ============================================================
   Ensaio de carga do caminho da INSCRIÇÃO.

   O site já foi medido com centenas de pessoas ABRINDO a página ao
   mesmo tempo. Isto aqui mede coisa diferente e mais perigosa:
   centenas se INSCREVENDO ao mesmo tempo — que é quando o banco
   escreve, conta vaga e fecha lote, e é onde uma corrida por vaga
   apareceria.

   Como roda sem sujar nada:
    - cria um evento de teste com data no passado. Ele PRECISA ficar
      publicado durante o ensaio, porque a função inscrever() recusa
      evento não publicado — e falsear isso mediria outra coisa que
      não o caminho de verdade. Fica publicado por menos de um minuto,
      de madrugada, aparece como "Concluído" e vai para o fim da
      lista; a primeira coisa que a limpeza faz é despublicar;
    - usa uma conta só, inscrevendo "dependentes". O aperto que
      interessa não é o de contas diferentes — é o de todo mundo
      disputando a MESMA vaga do MESMO lote, e isso uma conta só
      reproduz com fidelidade;
    - no fim apaga as inscrições e o evento. Não sobra rastro.

   Não testa o Mercado Pago de propósito: martelar o gateway de
   pagamento de verdade seria pedir bloqueio por abuso.

   Uso: colar no console do site, já logado com uma conta que
   administra. Ou deixar que a tarefa agendada rode de madrugada.
   ============================================================ */

window.ensaioDeCarga = async function ensaioDeCarga(opcoes) {
  const o = Object.assign({
    simultaneas: 30,      // quantas inscrições ao mesmo tempo
    rodadas: 2,           // quantas ondas dessas
    vagasNaCorrida: 10,   // fase 2: vagas de propósito escassas
    tentativasNaCorrida: 40,
    forcar: false         // só para eu testar; a tarefa agendada nunca usa
  }, opcoes || {});

  /* Trava de horário. A tarefa agendada roda "na próxima vez que o
     aplicativo abrir" se o computador estiver desligado às 3h — e aí ela
     poderia disparar às nove da manhã, com gente se inscrevendo e o evento
     de teste piscando na lista pública. Fora da janela morta, não roda. */
  const hora = new Date().getHours();
  if (!o.forcar && (hora >= 6)) {
    return { recusado: true, hora,
      motivo: "Fora da janela morta (0h-5h). Entre 6h e 23h chega gente se " +
              "inscrevendo, e o ensaio publica um evento de teste por alguns " +
              "segundos. Não rodei." };
  }

  const api = await import("/api.js");
  const relatorio = { quando: new Date().toISOString(), opcoes: o, fases: [] };
  const marca = "zz-ensaio-" + Date.now().toString(36);
  let evento = null;
  const criadas = [];

  const inscrever = (n) => api.inscrever({
    eventoId: evento.id, nome: "TESTE " + n, ehTitular: false,
    email: "", telefone: "", respostas: {}, observacao: marca
  });

  const onda = async (quantos, desde) => {
    const t0 = performance.now();
    const r = await Promise.allSettled(
      Array.from({ length: quantos }, (_, k) => inscrever(desde + k)));
    const ms = performance.now() - t0;
    const ok = r.filter(x => x.status === "fulfilled");
    for (const x of ok) if (x.value && x.value.id) criadas.push(x.value.id);
    const erros = {};
    for (const x of r) if (x.status === "rejected") {
      const m = String(x.reason && x.reason.message || x.reason).slice(0, 60);
      erros[m] = (erros[m] || 0) + 1;
    }
    return { pedidas: quantos, gravadas: ok.length, ms: Math.round(ms),
             porSegundo: +(quantos / (ms / 1000)).toFixed(1), erros };
  };

  try {
    /* ---- prepara o campo de provas ---- */
    evento = await api.salvarEvento({
      nome: "ZZ ENSAIO DE CARGA — pode apagar",
      slug: marca,
      publicado: true,               // exigido pela inscrever(); sai do ar na limpeza
      inscricoes_abertas: true,
      vagas: 0,                      // fase 1: sem limite
      data: "2020-01-01",   // no passado: aparece como "Concluído" e vai para o fim da lista
      lotes: [{ nome: "Único", preco_centavos: 100, quantidade: 0 }],
      perguntas: []
    });
    relatorio.eventoDeTeste = evento.id;

    /* ---- fase 1: quanto o banco aguenta gravar ---- */
    const f1 = [];
    for (let i = 0; i < o.rodadas; i++) f1.push(await onda(o.simultaneas, i * o.simultaneas));
    relatorio.fases.push({ fase: "gravação em massa", ondas: f1 });

    /* ---- fase 2: a corrida pela última vaga ----
       Aqui é o que realmente importa. Se o controle de vagas tiver
       brecha, saem MAIS inscrições do que vagas — e no dia da prova
       apareceria gente com inscrição paga e sem vaga. */
    await api.salvarEvento({ id: evento.id, vagas: o.vagasNaCorrida });
    const antes = criadas.length;
    const f2 = await onda(o.tentativasNaCorrida, 9000);
    relatorio.fases.push({
      fase: "corrida pela última vaga",
      vagasOferecidas: o.vagasNaCorrida,
      jaOcupadasAntes: antes,
      resultado: f2,
      /* o veredito: com as vagas já estouradas pela fase 1, nenhuma
         inscrição nova podia virar "paga"; as que passarem têm de
         entrar como espera. */
      observacao: "gravadas acima do limite indicam furo no controle de vagas"
    });

    /* ---- confere o que ficou de pé ---- */
    const { data: conferencia } = await api.sb.from("inscricoes")
      .select("status").eq("evento_id", evento.id);
    const porStatus = {};
    for (const i of conferencia || []) porStatus[i.status] = (porStatus[i.status] || 0) + 1;
    relatorio.situacaoFinal = porStatus;
    relatorio.totalGravado = (conferencia || []).length;

  } catch (e) {
    relatorio.erroFatal = String(e && e.message || e);
  } finally {
    /* ---- limpeza: primeiro as inscrições, depois o evento ----
       Nesta ordem porque o banco recusa apagar evento com inscrição
       pendurada — proteção que existe para o caso real, não para este. */
    let apagadas = 0;
    if (evento) {
      // Primeiro tira do ar, e só depois faz o resto: o tempo em que o evento
      // de teste fica visível é o que mais importa reduzir aqui.
      try { await api.salvarEvento({ id: evento.id, publicado: false }); }
      catch (e) { relatorio.falhouAoDespublicar = String(e.message || e); }
      /* Apaga tudo do evento de teste numa chamada só, e não uma por linha.
         Com centenas de inscrições, apagar uma a uma leva meio minuto e
         qualquer tropeço no meio deixa lixo para trás — justamente o que
         este ensaio não pode fazer. O filtro por evento_id é o que garante
         que nada de fora seja tocado. */
      const { data: tiradas } = await api.sb.from("inscricoes")
        .delete().eq("evento_id", evento.id).select("id");
      apagadas = (tiradas || []).length;
      try { await api.apagarEvento(evento.id); relatorio.eventoApagado = true; }
      catch (e) { relatorio.eventoApagado = "FALHOU: " + String(e.message || e); }
    }
    relatorio.inscricoesApagadas = apagadas;
    const { data: sobrou } = evento
      ? await api.sb.from("inscricoes").select("id").eq("evento_id", evento.id)
      : { data: [] };
    relatorio.sobrouAlgumaCoisa = (sobrou || []).length;
  }

  return relatorio;
};
"ensaio carregado";
