const symbols = ['gb_sp500', 'gb_inx', 'gb_$spx', 'gb_spx', 'int_sp500'];

async function test() {
  for (const s of symbols) {
    const url = `https://hq.sinajs.cn/list=${s}`;
    const res = await fetch(url, { headers: { 'Referer': 'https://finance.sina.com.cn' } });
    const text = await res.text();
    console.log(s, text.trim());
  }
}
test();
