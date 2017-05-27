import {loopHelper} from "./helpers/loopHelper";
import {initPrototypes} from "./prototypes/initPrototypes";
import {sandBox} from "./sandbox";
import {Profiler} from "./Profiler";
import {TimeoutTracker} from "./TimeoutTracker";
import {empire} from "./ai/Empire";
import {Viz} from "./helpers/Viz";
import {Patcher} from "./Patcher";

loopHelper.initMemory();
initPrototypes();
empire.initGlobal();

console.log(`Global Refresh CPU: ${Game.cpu.getUsed()}`);
try { loopHelper.initConsoleCommands(); } catch (e) { console.log("error loading console commands:\n", e.stack); }

module.exports.loop = function () {
    // console.log("beginning of loop");
    Game.cache = { structures: {}, hostiles: {}, hostilesAndLairs: {}, mineralCount: {}, labProcesses: {},
        activeLabCount: 0, placedRoad: false, fleeObjects: {}, lairThreats: {}, bypassCount: 0, exceptionCount: 0};
    Game.temp = {};

    // profile memory parsing
    let cpu = Game.cpu.getUsed();
    if (Memory) { }
    let result = Game.cpu.getUsed() - cpu;
    Profiler.resultOnly("mem", result);

    if (Patcher.checkPatch()) { return; }

    // TimeoutTracker - Diagnoses CPU timeouts
    try { TimeoutTracker.init(); } catch (e) { console.log("error initializing TimeoutTracker:\n", e.stack); }

    // Init phase - Information is gathered about the game state and game objects instantiated
    TimeoutTracker.log("init");
    Profiler.start("init");
    loopHelper.initEmpire();
    let operations = loopHelper.getOperations(empire);
    for (let operation of operations) { operation.init(); }
    Profiler.end("init");

    // RoleCall phase - Find creeps belonging to missions and spawn any additional needed.
    TimeoutTracker.log("roleCall");
    Profiler.start("roleCall");
    for (let operation of operations) { operation.roleCall(); }
    Profiler.end("roleCall");

    // Actions phase - Actions that change the game state are executed in this phase.
    TimeoutTracker.log("actions");
    Profiler.start("actions");
    for (let operation of operations) { operation.actions(); }
    Profiler.end("actions");

    // Finalize phase - Code that needs to run post-actions phase
    TimeoutTracker.log("finalize");
    for (let operation of operations) { operation.invalidateCache(); }
    Profiler.start("finalize");
    for (let operation of operations) { operation.finalize(); }
    Profiler.end("finalize");

    if (Game.cache.exceptionCount > 0) {
        console.log(`Exceptions this tick: ${Game.cache.exceptionCount}`);
    }

    if (Game.cache.bypassCount > 0) {
        console.log(`BYPASS: ${Game.cache.bypassCount}`);
    }

    // post-operation actions and utilities

    Profiler.start("postOperations");
    try { empire.actions(); } catch (e) { console.log("error with empire actions\n", e.stack); }
    try { loopHelper.scavangeResources(); } catch (e) { console.log("error scavanging:\n", e.stack); }
    try { loopHelper.sendResourceOrder(empire); } catch (e) { console.log("error reporting transactions:\n", e.stack); }
    try { loopHelper.garbageCollection(); } catch (e) { console.log("error during garbage collection:\n", e.stack ); }
    Profiler.end("postOperations");
    try { sandBox.run(); } catch (e) { console.log("error loading sandbox:\n", e.stack ); }
    try { Profiler.finalize(); } catch (e) { console.log("error checking Profiler:\n", e.stack); }
    try { loopHelper.grafanaStats(empire); } catch (e) { console.log("error reporting stats:\n", e.stack); }
    try { TimeoutTracker.finalize(); } catch (e) { console.log("error finalizing TimeoutTracker:\n", e.stack); }
    try { Viz.maintain(); } catch (e) { console.log("error with Viz:\n", e.stack); }

    if (!Memory.temp.timeout) {
        Memory.temp.timeout = Game.time + 1;
        console.log("scheduling timeout");
    }

    if (Memory.temp.timeout === Game.time) {
        console.log("building array");
        let array = [];
        for (let i = 0; i < 100000; i++) {
            array.push(Memory);
        }
        console.log("stringify it!");
        JSON.stringify(array);
    }

    // console.log(`end of loop, time: ${Game.time}, cpu ${Game.cpu.getUsed()}`);
};
