// Gerado a partir do prototipo ja testado do Balcao de Inscricoes.
export const Pix = (function () {
  function crc16(s) {
    let crc = 0xFFFF;
    for (let i = 0; i < s.length; i++) {
      crc ^= s.charCodeAt(i) << 8;
      for (let j = 0; j < 8; j++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
    }
    return crc.toString(16).toUpperCase().padStart(4, "0");
  }
  const campo = (id, valor) => id + String(valor.length).padStart(2, "0") + valor;
  const semAcento = s => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
  function limpar(s, max) {
    return semAcento(s).replace(/[^A-Za-z0-9 .\-]/g, "").trim().toUpperCase().slice(0, max);
  }
  function idTx(s) {
    const t = semAcento(s).replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 25);
    return t || "***";
  }
  function brcode(o) {
    let s = campo("00", "01") + campo("01", "12");
    s += campo("26", campo("00", "br.gov.bcb.pix") + campo("01", (o.chave || "").trim()));
    s += campo("52", "0000") + campo("53", "986");
    if (o.centavos > 0) s += campo("54", (o.centavos / 100).toFixed(2));
    s += campo("58", "BR");
    s += campo("59", limpar(o.beneficiario, 25) || "RECEBEDOR");
    s += campo("60", limpar(o.cidade, 15) || "BRASIL");
    s += campo("62", campo("05", idTx(o.txid)));
    s += "6304";
    return s + crc16(s);
  }
  return { brcode, crc16 };
})();
