import { defineSchedule } from "eve/schedules";
import { runKeeperScan } from "../lib/hosted.js";

export default defineSchedule({
  cron: "*/15 * * * *",
  async run() {
    const owner = process.env.UNABOT_KEEPER_OWNER;
    if (!owner) {
      // Without a configured owner there are no positions to scan; skip
      // cleanly instead of erroring the schedule every fifteen minutes.
      console.log(JSON.stringify({ schedule: "keeper", skipped: "UNABOT_KEEPER_OWNER is not set" }));
      return;
    }
    // Wizzy positions live on Robinhood Chain; Base stays covered for the
    // broader portfolio. Scheduled work is observe-only: a connected EOA
    // must review and approve every transaction plan.
    for (const chain of ["robinhood", "base"] as const) {
      try {
        const result = await runKeeperScan({ owner, live: false, chain });
        console.log(
          JSON.stringify({
            schedule: "keeper",
            chain,
            live: false,
            dryRun: true,
            owner: result.owner,
            decisions: result.decisions,
          }),
        );
      } catch (error) {
        console.error(
          JSON.stringify({
            schedule: "keeper",
            chain,
            error: error instanceof Error ? error.message : "keeper scan failed",
          }),
        );
      }
    }
  },
});
