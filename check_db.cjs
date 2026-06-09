const sqlite3 = require('better-sqlite3');
const db = new sqlite3('d:\\Projects\\finance\\.wrangler\\state\\v3\\d1\\miniflare-D1DatabaseObject\\3bf1482bbb6233ea0f7695bdae9cdebb58935840f681dc9d58953c237cf16ff0.sqlite');
console.log("CLOSED POSITIONS:");
console.log(db.prepare("SELECT * FROM positions WHERE status='CLOSED'").all());
console.log("ALL POSITIONS:");
console.log(db.prepare("SELECT id, status, close_price FROM positions").all());
