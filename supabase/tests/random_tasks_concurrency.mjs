// Integration test against the local migrated QA database. Creates an isolated
// temporary household and users, then removes every fixture in finally.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { strict as assert } from "node:assert";

function sql(statement) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", ["exec", "-i", "supabase_db_sweetmate-qa", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-Atq"], { stdio: ["pipe", "pipe", "pipe"] });
    let output = "", error = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { error += chunk; });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve(output.trim()) : reject(new Error(error.trim())));
    child.stdin.end(statement);
  });
}
const home = randomUUID(), a = randomUUID(), b = randomUUID(), task = randomUUID(), random = randomUUID();
const auth = (person) => `begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '${person}';
  set local request.headers = '{"x-sweetmate-chore-policy":"single-obligation-v1"}';`;
try {
  await sql(`insert into auth.users(id,email) values ('${a}','${a}@random-concurrency.invalid'),('${b}','${b}@random-concurrency.invalid');
    insert into public.households(id,name,invite_code,created_by) values ('${home}','Random concurrency regression','${home}','${a}');
    insert into public.household_members(household_id,user_id,display_name,role,status)
      values ('${home}','${a}','Avery','owner','active'),('${home}','${b}','Blake','member','active');`);
  await sql(`${auth(a)} select public.create_household_random_task('${home}','${task}','Race to claim','up-for-grabs'); commit;`);
  const claims = await Promise.allSettled([a,b].map((person) => sql(`${auth(person)} select public.claim_household_random_task('${home}','${task}'); commit;`)));
  assert.equal(claims.filter((result) => result.status === "fulfilled").length, 1, "exactly one simultaneous claimant must win");
  const failed = claims.find((result) => result.status === "rejected");
  assert.match(failed.reason.message, /already been claimed or assigned/);
  const record = JSON.parse(await sql(`select json_build_object('count',count(*),'winner',min(assigned_to::text)) from public.chores where source_key='random-task:${task}';`));
  assert.equal(record.count, 1);
  assert.ok([a,b].includes(record.winner));
  const creates = await Promise.allSettled([1,2].map(() => sql(`${auth(a)} select public.create_household_random_task('${home}','${random}','Retry the same draw','random'); commit;`)));
  assert.ok(creates.every((result) => result.status === "fulfilled"), "simultaneous create retries must both return the saved task");
  assert.equal(await sql(`select count(*) from public.chores where source_key='random-task:${random}';`), "1", "create retries must never draw twice");
  console.log("Simultaneous random task claims and idempotent draw tests passed");
} finally {
  await sql(`delete from public.households where id='${home}'; delete from auth.users where id in ('${a}','${b}');`);
}
