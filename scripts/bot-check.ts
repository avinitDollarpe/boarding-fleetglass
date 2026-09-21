import assert from "node:assert/strict";
import { channelAllowed, githubMentioned, slackMentioned } from "../src/lib/bots";

assert.equal(slackMentioned("hey @Fleetglass check this", { handle: "Fleetglass", aliases: [] }), true);
assert.equal(slackMentioned("<@U123> please", { handle: "Fleetglass", aliases: [], botUserId: "U123" }), true);
assert.equal(slackMentioned("@Chief the deploy", { handle: "Fleetglass", aliases: ["Chief"] }), true);
assert.equal(slackMentioned("@cursor do it", { handle: "Fleetglass", aliases: ["Chief"] }), false);
assert.equal(slackMentioned("email fleetglass@example.com", { handle: "Fleetglass", aliases: [] }), false);

assert.equal(githubMentioned("@fleetglass look", ["fleetglass"]), true);
assert.equal(githubMentioned("@fleetglass[bot] look", ["fleetglass"]), true);
assert.equal(githubMentioned("@cursor look", ["fleetglass", "chakravarti"]), false);
assert.equal(githubMentioned("no mention", []), false);

assert.equal(channelAllowed([], "C1", "eng"), true);
assert.equal(channelAllowed(["eng-supervisor"], "C1", "eng-supervisor"), true);
assert.equal(channelAllowed(["C1"], "C1", "random"), true);
assert.equal(channelAllowed(["#eng"], "C9", "eng"), true);
assert.equal(channelAllowed(["eng"], "C9", "ops"), false);

console.log("bot checks ok");
