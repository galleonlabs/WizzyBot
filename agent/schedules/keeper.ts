import { defineSchedule } from "eve/schedules";
import { keeperLiveEnabled, runKeeperScan } from "../lib/hosted.js";

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
    const live = keeperLiveEnabled();
    const result = await runKeeperScan({ owner, live });
    console.log(
      JSON.stringify({
        schedule: "keeper",
        live,
        dryRun: !live,
        owner: result.owner,
        decisions: result.decisions,
      }),
    );
  },
});
