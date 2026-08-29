// Codificador de QR Code (modo byte, correcao nivel M, versoes 1-15).
// Extraido do prototipo ja validado do Balcao de Inscricoes.
export const QR = (function () {
  const EXP = new Array(512), LOG = new Array(256);
  (function () {
    let x = 1;
    for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();
  const mul = (a, b) => (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]];

  function genPoly(n) {
    let p = [1];
    for (let i = 0; i < n; i++) {
      const np = new Array(p.length + 1).fill(0);
      for (let j = 0; j < p.length; j++) { np[j] ^= p[j]; np[j + 1] ^= mul(p[j], EXP[i]); }
      p = np;
    }
    return p;
  }
  function ecBytes(data, n) {
    const gen = genPoly(n);
    const res = new Array(data.length + n).fill(0);
    for (let i = 0; i < data.length; i++) res[i] = data[i];
    for (let i = 0; i < data.length; i++) {
      const c = res[i];
      if (c === 0) continue;
      for (let j = 0; j < gen.length; j++) res[i + j] ^= mul(gen[j], c);
    }
    return res.slice(data.length);
  }

  // versão: [ec por bloco, blocos grupo1, palavras g1, blocos g2, palavras g2, capacidade em bytes]
  const TAB = {
    1: [10, 1, 16, 0, 0, 14], 2: [16, 1, 28, 0, 0, 26], 3: [26, 1, 44, 0, 0, 42],
    4: [18, 2, 32, 0, 0, 62], 5: [24, 2, 43, 0, 0, 84], 6: [16, 4, 27, 0, 0, 106],
    7: [18, 4, 31, 0, 0, 122], 8: [22, 2, 38, 2, 39, 152], 9: [22, 3, 36, 2, 37, 180],
    10: [26, 4, 43, 1, 44, 213], 11: [30, 1, 50, 4, 51, 251], 12: [22, 6, 36, 2, 37, 287],
    13: [22, 8, 37, 1, 38, 331], 14: [24, 4, 40, 5, 41, 362], 15: [24, 5, 41, 5, 42, 412]
  };
  const ALINHA = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38],
    8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50], 11: [6, 30, 54], 12: [6, 32, 58],
    13: [6, 34, 62], 14: [6, 26, 46, 66], 15: [6, 26, 48, 70]
  };

  function utf8(s) {
    const out = [];
    for (const b of new TextEncoder().encode(s)) out.push(b);
    return out;
  }
  function restoBCH(v, poly) {
    const grauPoly = Math.floor(Math.log2(poly));
    let r = v;
    while (Math.floor(Math.log2(r)) >= grauPoly && r !== 0) {
      r ^= poly << (Math.floor(Math.log2(r)) - grauPoly);
    }
    return r;
  }

  function matriz(texto) {
    const dados = utf8(texto);
    let versao = 0;
    for (let v = 1; v <= 15; v++) { if (dados.length <= TAB[v][5]) { versao = v; break; } }
    if (!versao) throw new Error("conteúdo longo demais para o QR");
    const [ecN, b1, w1, b2, w2] = TAB[versao];
    const totalDados = b1 * w1 + b2 * w2;

    // fluxo de bits
    const bits = [];
    const põe = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >> i) & 1); };
    põe(0b0100, 4);
    põe(dados.length, versao >= 10 ? 16 : 8);
    for (const b of dados) põe(b, 8);
    const capBits = totalDados * 8;
    for (let i = 0; i < 4 && bits.length < capBits; i++) bits.push(0);
    while (bits.length % 8) bits.push(0);
    const bytes = [];
    for (let i = 0; i < bits.length; i += 8) {
      let v = 0; for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
      bytes.push(v);
    }
    const enchimento = [0xEC, 0x11];
    let k = 0;
    while (bytes.length < totalDados) bytes.push(enchimento[k++ % 2]);

    // blocos + correção de erro
    const blocosD = [], blocosE = [];
    let p = 0;
    for (let i = 0; i < b1; i++) { const bl = bytes.slice(p, p + w1); p += w1; blocosD.push(bl); blocosE.push(ecBytes(bl, ecN)); }
    for (let i = 0; i < b2; i++) { const bl = bytes.slice(p, p + w2); p += w2; blocosD.push(bl); blocosE.push(ecBytes(bl, ecN)); }
    const finais = [];
    const maxW = Math.max(w1, w2);
    for (let i = 0; i < maxW; i++) for (const bl of blocosD) if (i < bl.length) finais.push(bl[i]);
    for (let i = 0; i < ecN; i++) for (const bl of blocosE) finais.push(bl[i]);

    // matriz
    const n = 17 + versao * 4;
    const m = Array.from({ length: n }, () => new Array(n).fill(0));
    const res = Array.from({ length: n }, () => new Array(n).fill(false));
    const set = (r, c, v) => { m[r][c] = v; res[r][c] = true; };

    function localizador(lr, lc) {
      for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) {
        const rr = lr + r, cc = lc + c;
        if (rr < 0 || cc < 0 || rr >= n || cc >= n) continue;
        const dentro = (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
                       (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
                       (r >= 2 && r <= 4 && c >= 2 && c <= 4);
        set(rr, cc, dentro ? 1 : 0);
      }
    }
    localizador(0, 0); localizador(0, n - 7); localizador(n - 7, 0);

    for (let i = 8; i < n - 8; i++) { const v = i % 2 === 0 ? 1 : 0; set(6, i, v); set(i, 6, v); }

    for (const r of ALINHA[versao]) for (const c of ALINHA[versao]) {
      if ((r <= 8 && c <= 8) || (r <= 8 && c >= n - 9) || (r >= n - 9 && c <= 8)) continue;
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
        const borda = Math.max(Math.abs(dr), Math.abs(dc));
        set(r + dr, c + dc, borda === 1 ? 0 : 1);
      }
    }

    set(n - 8, 8, 1); // módulo sempre escuro
    for (let i = 0; i < 9; i++) { if (!res[8][i]) set(8, i, 0); if (!res[i][8]) set(i, 8, 0); }
    for (let i = 0; i < 8; i++) { if (!res[8][n - 1 - i]) set(8, n - 1 - i, 0); if (!res[n - 1 - i][8]) set(n - 1 - i, 8, 0); }

    if (versao >= 7) {
      const vi = (versao << 12) | restoBCH(versao << 12, 0x1F25);
      for (let i = 0; i < 18; i++) {
        const bit = (vi >> i) & 1;
        set(Math.floor(i / 3), n - 11 + (i % 3), bit);
        set(n - 11 + (i % 3), Math.floor(i / 3), bit);
      }
    }

    // dados em ziguezague
    let idx = 0, subir = true;
    for (let col = n - 1; col > 0; col -= 2) {
      if (col === 6) col--;
      for (let t = 0; t < n; t++) {
        const linha = subir ? n - 1 - t : t;
        for (let dc = 0; dc < 2; dc++) {
          const c = col - dc;
          if (res[linha][c]) continue;
          const bit = idx < finais.length * 8 ? (finais[idx >> 3] >> (7 - (idx & 7))) & 1 : 0;
          m[linha][c] = bit; idx++;
        }
      }
      subir = !subir;
    }

    const mascaras = [
      (r, c) => (r + c) % 2 === 0,
      (r) => r % 2 === 0,
      (r, c) => c % 3 === 0,
      (r, c) => (r + c) % 3 === 0,
      (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
      (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
      (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
      (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0
    ];

    function penalidade(g) {
      let p = 0;
      for (let i = 0; i < n; i++) {
        for (const eixo of [0, 1]) {
          let run = 1;
          for (let j = 1; j < n; j++) {
            const a = eixo ? g[j][i] : g[i][j], b = eixo ? g[j - 1][i] : g[i][j - 1];
            if (a === b) run++; else { if (run >= 5) p += 3 + (run - 5); run = 1; }
          }
          if (run >= 5) p += 3 + (run - 5);
        }
      }
      for (let r = 0; r < n - 1; r++) for (let c = 0; c < n - 1; c++) {
        const v = g[r][c];
        if (v === g[r][c + 1] && v === g[r + 1][c] && v === g[r + 1][c + 1]) p += 3;
      }
      const alvo = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
      const casa = (arr, i) => {
        for (let k = 0; k < 11; k++) if (arr[i + k] !== alvo[k]) return false;
        return true;
      };
      for (let i = 0; i < n; i++) {
        const lin = g[i], col = g.map(r => r[i]);
        const linR = lin.slice().reverse(), colR = col.slice().reverse();
        for (let j = 0; j + 11 <= n; j++) {
          if (casa(lin, j)) p += 40;
          if (casa(linR, j)) p += 40;
          if (casa(col, j)) p += 40;
          if (casa(colR, j)) p += 40;
        }
      }
      let escuros = 0;
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) escuros += g[r][c];
      const pct = (escuros * 100) / (n * n);
      p += Math.floor(Math.abs(pct - 50) / 5) * 10;
      return p;
    }

    let melhor = null, melhorP = Infinity;
    for (let mk = 0; mk < 8; mk++) {
      const g = m.map(r => r.slice());
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
        if (!res[r][c] && mascaras[mk](r, c)) g[r][c] ^= 1;
      }
      const fmt = ((0b00 << 3) | mk); // nível M = 00
      const bitsFmt = ((fmt << 10) | restoBCH(fmt << 10, 0x537)) ^ 0x5412;
      const bitF = i => (bitsFmt >> i) & 1;
      // primeira cópia, em volta do localizador superior esquerdo
      for (let i = 0; i <= 5; i++) g[i][8] = bitF(i);
      g[7][8] = bitF(6);
      g[8][8] = bitF(7);
      g[8][7] = bitF(8);
      for (let i = 9; i < 15; i++) g[8][14 - i] = bitF(i);
      // segunda cópia, dividida entre os outros dois localizadores
      for (let i = 0; i < 8; i++) g[8][n - 1 - i] = bitF(i);
      for (let i = 8; i < 15; i++) g[n - 15 + i][8] = bitF(i);
      g[n - 8][8] = 1;
      const pen = penalidade(g);
      if (pen < melhorP) { melhorP = pen; melhor = g; }
    }
    return melhor;
  }

  function svg(texto, borda) {
    const m = matriz(texto);
    const n = m.length, b = borda == null ? 4 : borda, total = n + b * 2;
    let d = "";
    for (let r = 0; r < n; r++) {
      let c = 0;
      while (c < n) {
        if (!m[r][c]) { c++; continue; }
        let fim = c;
        while (fim + 1 < n && m[r][fim + 1]) fim++;
        d += "M" + (c + b) + "," + (r + b) + "h" + (fim - c + 1) + "v1h-" + (fim - c + 1) + "z";
        c = fim + 1;
      }
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + total + ' ' + total +
      '" shape-rendering="crispEdges" role="img" aria-label="QR Code do Pix">' +
      '<rect width="' + total + '" height="' + total + '" fill="#ffffff"/>' +
      '<path d="' + d + '" fill="#000000"/></svg>';
  }

  return { svg, matriz };
})();
