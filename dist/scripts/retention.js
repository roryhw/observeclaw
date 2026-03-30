import { db } from '../db/index.js';
import { loadPolicy, runRetention } from '../retention/policy.js';
async function main() {
    try {
        const policy = loadPolicy(db);
        const result = runRetention(db, policy, { runCheckpoint: true, runVacuum: false });
        console.log(JSON.stringify(result, null, 2));
        process.exit(0);
    }
    catch (err) {
        console.error(err);
        process.exit(1);
    }
}
main();
//# sourceMappingURL=retention.js.map