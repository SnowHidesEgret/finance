const symbols = ['rt_hkHSI', 'hkHSI', 'int_hangseng', 'gb_hsi', 'hk_HSI'];

async function test() {
  for (const s of symbols) {
    const url = `https://hq.sinajs.cn/list=${s}`;
    const res = await fetch(url, { headers: { 'Referer': 'https://finance.sina.com.cn' } });
    const text = await res.text();
    console.log(s, text.trim());
  }
}
test();
