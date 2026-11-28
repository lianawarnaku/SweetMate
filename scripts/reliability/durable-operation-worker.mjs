// Child process used only by the local termination test. Never logs credentials.
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { ExpenseSync } from "../../artifacts/mobile/lib/expenseSync.ts";
import { DurableOperations } from "../../artifacts/mobile/lib/durableOperations.ts";
const config = JSON.parse(await readFile(process.argv[2], "utf8"));
if (config.api !== "http://127.0.0.1:54321") throw Error("Local QA only");
process.on("message", async (job) => {
  try {
    const path = config.directory + "/" + job.user.id + ".json";
    const storage = {
      getItem: async () =>
        readFile(path, "utf8").catch((error) => {
          if (error.code === "ENOENT") return null;
          throw error;
        }),
      setItem: async (_key, value) => {
        const tmp = path + ".tmp";
        await writeFile(tmp, value, { mode: 0o600 });
        await rename(tmp, path);
      },
    };
    const sendApp = async (operation) => {
      if (job.phase === "before-send") {
        process.send({ phase: "journaled" });
        await new Promise(() => {});
      }
      const headers = {
        apikey: config.anon,
        Authorization: "Bearer " + job.user.token,
        "Content-Type": "application/json",
      };
      const response = await fetch(config.api + "/rest/v1/rpc/mutate_expense", {
        method: "POST",
        headers,
        signal: AbortSignal.timeout(15000),
        body: JSON.stringify({
          p_household_id: job.home,
          p_operation_id: operation.operationId,
          p_action: operation.action,
          p_expense_id: operation.expenseId,
          p_payload: operation.payload,
          p_expected_version: operation.expectedVersion,
        }),
      });
      const value = await response.json();
      if (!response.ok) {
        process.send({ phase: "error", message: value.message });
        throw Error("Expense rejected");
      }
      if (job.phase === "after-commit") {
        process.send({
          phase: "committed",
          value: { status: 200, data: value },
        });
        await new Promise(() => {});
      }
      return value;
    };
    const engine =
      job.kind === "expense"
        ? new ExpenseSync({
            householdId: job.home,
            userId: job.user.id,
            storage,
            makeOperationId: () => randomUUID(),
            fetch: async () => {
              const response = await fetch(
                config.api + "/rest/v1/expenses?household_id=eq." + job.home,
                {
                  headers: {
                    apikey: config.anon,
                    Authorization: "Bearer " + job.user.token,
                  },
                },
              );
              if (!response.ok) throw Error("Expense refresh failed");
              return response.json();
            },
            mutate: sendApp,
            onRows: () => {},
            onState: () => {},
          })
        : new DurableOperations({
            userId: job.user.id,
            storage,
            makeId: () => randomUUID(),
            changed: () => {},
            send: async (operation) => {
              if (job.phase === "before-send") {
                process.send({ phase: "journaled" });
                await new Promise(() => {});
              }
              const response = await fetch(
                operation.request.edge
                  ? config.edgeApi + "/functions/v1/" + operation.request.name
                  : config.api + "/rest/v1/rpc/execute_app_operation",
                {
                  method: "POST",
                  headers: {
                    apikey: config.anon,
                    Authorization: "Bearer " + job.user.token,
                    "Content-Type": "application/json",
                    "x-sweetmate-chore-policy": "single-obligation-v1",
                  },
                  body: JSON.stringify(
                    operation.request.edge
                      ? operation.request.body
                      : {
                          operation_id: operation.id,
                          operation_request: operation.request,
                        },
                  ),
                },
              );
              const value = await response.json();
              const result = operation.request.edge
                ? { status: response.status, data: value }
                : value;
              if (!response.ok || result.status >= 300) {
                process.send({
                  phase: "error",
                  code: value.code,
                  message: value.message ?? JSON.stringify(value),
                });
                throw Error("Mutation rejected");
              }
              if (job.phase === "after-commit") {
                process.send({ phase: "committed", value: result });
                await new Promise(() => {});
              }
              return result;
            },
          });
    if (job.phase === "before-send") {
      if (job.kind === "expense") {
        await engine.initialize();
        await engine.submit(
          job.request.action,
          job.request.expenseId,
          job.request.payload,
          job.request.version,
        );
      } else await engine.submit(job.request, job.scope);
    } else await engine.initialize();
    process.send({
      phase: "done",
      pending:
        job.kind === "expense" ? engine.state.pending : engine.pending.length,
    });
  } catch (error) {
    process.send({ phase: "error", message: error.message });
  }
});
