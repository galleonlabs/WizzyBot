import { defineSchedule } from "eve/schedules";
import { keeperLiveEnabled, runKeeperScan } from "../../src/surfaces/hosted.js";

export default defineSchedule({
  cron: "*/15 * * * *",
  async run() {
    const live = keeperLiveEnabled();
    const result = await runKeeperScan({ live });
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
