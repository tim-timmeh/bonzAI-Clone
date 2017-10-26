import {Mission, MissionMemory, MissionState} from "./Mission";
import {Operation} from "../operations/Operation";
import {Agent} from "../agents/Agent";
import {MatrixHelper} from "../../helpers/MatrixHelper";
import {Traveler, TravelToReturnData} from "../../Traveler";

interface RemoteUpgradeState extends MissionState {
    inboundEnergy: number;
    site: ConstructionSite;
    container: StructureContainer;
    target: Flag;
    energySource: StoreStructure;
}

interface RemoteUpgradeMemory extends MissionMemory {
    distance: number;
    localSource: boolean;
    spawnDistance: number;
}

export class RemoteUpgradeMission extends Mission {

    private builders: Agent[];
    private carts: Agent[];
    private positions: RoomPosition[];
    private upgraders: Agent[];

    public state: RemoteUpgradeState;
    public memory: RemoteUpgradeMemory;
    private longRangeSpawn: boolean;

    constructor(operation: Operation) {
        super(operation, "vremUpgrade");
    }

    protected init() {
        if (!this.state.hasVision) {
            this.operation.removeMission(this);
            return;
        }
    }

    protected update() {
        this.state.target = Game.flags[`${this.operation.name}_target`];
        if (!this.state.target) {
            return;
        }

        this.longRangeSpawn = Game.map.getRoomLinearDistance(this.state.target.pos.roomName, this.spawnGroup.pos.roomName) > 2;

        // use the storage in spawning room or in local room
        this.state.energySource = this.room.storage;
        let localRoomReady = this.state.target.room.storage && this.state.target.room.storage.store.energy >= 100000;
        if (this.memory.localSource || localRoomReady) {
            if (!this.memory.localSource) {
                this.memory.localSource = true;
                this.memory.distance = undefined;
                this.memory.spawnDistance = undefined;
            }
            this.state.energySource = this.state.target.room.storage;
        }

        // figure out the distance for prespawn purposes
        if (!this.memory.distance) {
            this.memory.distance = Traveler.findTravelPath(this.state.energySource, this.state.target, {
                offRoad: true,
            }).path.length;
        }

        if (!this.memory.spawnDistance) {
            this.memory.spawnDistance = Traveler.findTravelPath(this.spawnGroup, this.state.target).path.length;
        }

        // find container or build one
        this.state.container = this.state.target.pos.lookForStructure<StructureContainer>(STRUCTURE_CONTAINER);
        if (this.state.container) {
            if (!this.positions) {
                this.positions = _(this.state.container.pos.openAdjacentSpots(true))
                    .filter(x => !x.lookForStructure(STRUCTURE_ROAD) && x.inRangeTo(this.state.target.room.controller, 3))
                    .value();
                this.positions = this.positions.concat([ this.state.container.pos]);
            }

            /*PaverMission.updatePath(this.operation.name + this.name, this.state.energySource.pos,
                this.state.container.pos, 0, this.memory);*/
        } else {
            this.state.site = this.state.target.pos.lookFor<ConstructionSite>(LOOK_CONSTRUCTION_SITES)[0];
            if (!this.state.site) {
                this.state.target.pos.createConstructionSite(STRUCTURE_CONTAINER);
            }
        }
    }

    protected getMaxBuilders = () => {
        if (this.state.site && !this.longRangeSpawn) {
            return 1;
        } else {
            return 0;
        }
    };

    protected getBuilderBody = () => {
        return this.workerUnitBody(1, 3.5, .5);
    };

    protected getMaxCarts = () => {
        if (this.state.container) {
            let upgCount = this.roleCount("upgrade");
            let potency = upgCount * 31;
            if (this.longRangeSpawn) {
                potency = upgCount * 23;
            }
            let analysis = this.cacheTransportAnalysis(this.memory.distance, potency);
            return analysis.cartsNeeded;
        } else {
            return 1;
        }
    };

    protected getUpgraderBody = () => {
        if (this.longRangeSpawn) {
            return this.workerBody(23, 4, 23);
        } else {
            return this.workerUnitBody(7.5, 1, 4);
        }
    };

    protected getMaxUpgraders = () => {
        let hostilesPresent = this.state.target && this.state.target.room && this.state.target.room.hostiles.length > 0;
        let leveledUp = this.state.target && this.state.target.room && this.state.target.room.controller.level === 8;
        if (!this.positions || hostilesPresent || leveledUp) { return 0; }
        if (this.memory.max !== undefined ) { return this.memory.max; }
        return this.positions.length;
    };

    protected roleCall() {
        this.carts = this.headCount("cart", this.standardCartBody, this.getMaxCarts, {
            memory: { scavenger: RESOURCE_ENERGY },
            prespawn: this.memory.spawnDistance,
        });

        this.builders = this.headCount("builder", this.getBuilderBody, this.getMaxBuilders, {
            boosts: [RESOURCE_CATALYZED_LEMERGIUM_ACID],
            allowUnboosted: true,
        });

        this.upgraders = this.headCount("upgrade", this.getUpgraderBody, this.getMaxUpgraders, {
            prespawn: this.memory.spawnDistance,
            boosts: [RESOURCE_CATALYZED_GHODIUM_ACID],
            allowUnboosted: true,
        });
    }

    protected actions() {
        for (let builder of this.builders) {
            this.builderActions(builder);
        }

        if (this.state.container) {
            this.carts = _.sortBy(this.carts, x => x.pos.getRangeTo(this.state.container));
        }
        for (let cart of this.carts) {
            this.cartActions(cart);
        }

        let order = 0;
        for (let upgrader of this.upgraders) {
            this.upgraderActions(upgrader, order++);
        }
    }

    protected finalize() {
    }

    protected invalidateCache() {
        delete this.memory.distance;
    }

    private builderActions(builder: Agent) {
        if (!this.state.site) {
            this.swapRole(builder, "builder", "upgrade");
            return;
        }

        let data: TravelToReturnData = {};
        let options = {
            offRoad: true,
            stuckValue: Number.MAX_VALUE,
            returnData: data,
        };

        if (builder.pos.isNearExit(0)) {
            builder.travelTo(this.state.site, options);
            return;
        }

        let road = builder.pos.lookForStructure(STRUCTURE_ROAD);
        if (!road) {
            let site = builder.pos.lookFor<ConstructionSite>(LOOK_CONSTRUCTION_SITES)[0];
            if (site) {
                builder.build(site);
            } else {
                builder.pos.createConstructionSite(STRUCTURE_ROAD);
            }
            return;
        }

        if (road.hits < road.hitsMax) {
            builder.repair(road);
            return;
        }

        if (builder.pos.isNearTo(this.state.site)) {
            builder.build(this.state.site);
        } else {
            builder.travelTo(this.state.site, options);
            if (data.nextPos) {
                let creep = data.nextPos.lookFor<Creep>(LOOK_CREEPS)[0];
                if (creep) {
                    builder.say("trade ya");
                    creep.move(creep.pos.getDirectionTo(builder));
                }
            }
        }
    }

    private cartActions(cart: Agent) {
        let hasLoad = cart.hasLoad();
        if (!hasLoad) {
            let outcome = cart.retrieve(this.state.energySource, RESOURCE_ENERGY);
            if (outcome === OK) {
                if (this.state.container) {
                    cart.travelTo(this.state.container);
                }
            }
            return;
        }

        if (this.state.container) {

            let range = cart.pos.getRangeTo(this.state.container);
            if (range > 5) {
                cart.travelTo(this.state.container, { roomCallback: (roomName, matrix) => {
                    if (roomName !== this.state.target.pos.roomName) { return; }
                    let link = this.state.target.room.controller.pos.findInRange(
                        cart.room.findStructures<StructureLink>(STRUCTURE_LINK), 3)[0];
                    if (link) {
                        matrix = matrix.clone();
                        MatrixHelper.blockOffPosition(matrix, link, 1);
                        return matrix;
                    }
                }});
                return;
            }

            if (this.state.inboundEnergy === undefined) {
                this.state.inboundEnergy = this.state.container.store.energy;
            }

            if (cart.carry.energy === cart.carryCapacity && this.state.inboundEnergy > 1200) {
                cart.idleNear(this.state.container, 4);
                return;
            }

            this.state.inboundEnergy += cart.carry.energy;
        }

        let destination: Creep|StoreStructure = this.state.container;
        if (!destination && this.builders.length > 0) {
            destination = this.builders[0].creep;
        }

        if (!destination) {
            cart.idleOffRoad();
            return;
        }

        let outcome = cart.deliver(destination, RESOURCE_ENERGY);
        if (outcome === OK) {
            let dropOff = Agent.normalizeStore(destination);
            let spaceAvailable = dropOff.storeCapacity - dropOff.store.energy;
            if (cart.carry.energy < spaceAvailable) {
                if (cart.ticksToLive < this.memory.distance * 2 + 50) {
                    cart.suicide();
                    return;
                }
                cart.travelTo(this.state.energySource);
            }
        }
    }

    private upgraderActions(upgrader: Agent, order: number) {
        if (!this.longRangeSpawn && !upgrader.memory.hasLoad && upgrader.room === this.room) {
            upgrader.travelTo(this.room.storage);
            let outcome = upgrader.withdraw(this.room.storage, RESOURCE_ENERGY, 100);
            if (outcome === OK) {
                upgrader.memory.hasLoad = true;
            } else {
                return;
            }
        }

        if (!this.positions || !this.state.target) {
            upgrader.idleOffRoad();
            return;
        }

        let position = this.positions[order];
        if (!position || !this.state.container) {
            upgrader.idleNear(this.state.target, 3);
            return;
        }

        if (upgrader.isAt(position)) {
            if (upgrader.carry.energy < 120) {
                upgrader.withdraw(this.state.container, RESOURCE_ENERGY);
            }

            if (this.state.container.hits < this.state.container.hitsMax * .8) {
                upgrader.repair(this.state.container);
            } else {
                upgrader.upgradeController(upgrader.room.controller);
            }
        } else {
            let road = upgrader.pos.lookForStructure<StructureRoad>(STRUCTURE_ROAD);
            if (road && road.hits < road.hitsMax * .6) {
                upgrader.repair(road);
            }

            upgrader.moveItOrLoseIt(position, "upgrade", false, {stuckValue: 4});
        }
    }
}
