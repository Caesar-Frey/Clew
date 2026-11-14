import type { PlannedReminder } from "../src/reminders/plan";
import type { ReminderPermission } from "../src/reminders/scheduler";
import { createReminderSyncer } from "../src/reminders/syncer";

const reminder = (id: string): PlannedReminder => ({
  id,
  at: 1,
  title: "t",
  body: "b",
  itemId: "i",
});

function setup(initial: ReminderPermission) {
  const state = {
    permission: initial,
    asked: false,
    plan: [reminder("due:1")],
    scheduled: [] as PlannedReminder[][],
    asks: 0,
    failNext: false,
  };
  let syncer: ReturnType<typeof createReminderSyncer>;
  syncer = createReminderSyncer({
    plan: () => state.plan,
    permission: async () => state.permission,
    ask: async () => {
      state.asks++;
      state.permission = "granted";
      return true;
    },
    asked: () => state.asked,
    markAsked: async () => {
      // Like setSetting: refreshes the snapshot, which re-renders and re-runs the sync mid-flight.
      state.asked = true;
      void syncer.run();
    },
    schedule: async (plan) => {
      if (state.failNext) {
        state.failNext = false;
        throw new Error("partial");
      }
      state.scheduled.push(plan);
    },
  });
  return { state, syncer };
}

describe("reminder syncing", () => {
  it('schedules on the very first grant, even though saving "asked" re-renders mid-way', async () => {
    const { state, syncer } = setup("undetermined");
    await syncer.run();
    expect(state.asks).toBe(1);
    expect(state.scheduled).toEqual([[reminder("due:1")]]);
  });

  it("asks only once on its own, and only marks it asked after the prompt", async () => {
    const { state, syncer } = setup("undetermined");
    state.asked = true;
    await syncer.run();
    expect(state.asks).toBe(0);
    expect(state.scheduled).toEqual([]);
  });

  it("retries after a failed schedule and on a forced (foreground) run", async () => {
    const { state, syncer } = setup("granted");
    state.failNext = true;
    await syncer.run();
    expect(state.scheduled).toEqual([]);
    await syncer.run();
    expect(state.scheduled).toHaveLength(1);
    await syncer.run();
    expect(state.scheduled).toHaveLength(1);
    await syncer.run(true);
    expect(state.scheduled).toHaveLength(2);
  });

  it("clears reminders when there is nothing to remind about, even without permission", async () => {
    const { state, syncer } = setup("denied");
    state.plan = [];
    await syncer.run();
    expect(state.scheduled).toEqual([[]]);
  });
});
