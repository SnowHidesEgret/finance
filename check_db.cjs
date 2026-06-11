const { execSync } = require('child_process');

try {
  console.log("Fetching local schema...");
  const localOutput = execSync('npx wrangler d1 execute stockvault-db --command="SELECT sql FROM sqlite_master WHERE type=\'table\' AND name NOT LIKE \'sqlite_%\' AND name != \'d1_migrations\' ORDER BY name;" --local --json').toString();
  
  console.log("Fetching remote schema...");
  const remoteOutput = execSync('npx wrangler d1 execute stockvault-db --command="SELECT sql FROM sqlite_master WHERE type=\'table\' AND name NOT LIKE \'sqlite_%\' AND name != \'d1_migrations\' ORDER BY name;" --remote --json').toString();

  const localData = JSON.parse(localOutput)[0].results.map(r => r.sql);
  const remoteData = JSON.parse(remoteOutput)[0].results.map(r => r.sql);

  let isSame = true;
  if (localData.length !== remoteData.length) {
    isSame = false;
    console.log(`Table count mismatch: Local=${localData.length}, Remote=${remoteData.length}`);
  } else {
    for (let i = 0; i < localData.length; i++) {
      if (localData[i] !== remoteData[i]) {
        isSame = false;
        console.log(`Mismatch in table definition:\nLocal: ${localData[i]}\nRemote: ${remoteData[i]}`);
      }
    }
  }

  if (isSame) {
    console.log("RESULT: YES, Local and Remote database schemas are exactly the same.");
  } else {
    console.log("RESULT: NO, Local and Remote database schemas differ.");
  }
} catch (e) {
  console.error("Error executing commands:", e.message);
  if (e.stdout) console.error("Stdout:", e.stdout.toString());
  if (e.stderr) console.error("Stderr:", e.stderr.toString());
}
