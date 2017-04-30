var utilities = require('utilities');

var RoomPlanner = function (roomName) {
  this.roomPlannerVersion = 10;
  this.roomName = roomName;
  this.room = Game.rooms[roomName]; // Will not always be available.

  if (!Memory.rooms[roomName]) {
    Memory.rooms[roomName] = {};
  }
  if (!Memory.rooms[roomName].roomPlanner) {
    Memory.rooms[roomName].roomPlanner = {};
  }
  this.memory = Memory.rooms[roomName].roomPlanner;

  // Automatically assume control over any room.
  if (this.room.controller && this.room.controller.my) {
    this.memory.controlRoom = true;
  }
  else {
    this.memory.controlRoom = false;
  }

  this.drawDebug();
};

RoomPlanner.prototype.drawDebug = function () {
  let debugSymbols = {
    container: 'c',
    lab: 'L',
    link: 'l',
    rampart: 'R',
    spawn: 'S',
    storage: 's',
    terminal: 't',
    tower: 'T',
    wall: 'W',
  };

  let visual = new RoomVisual(this.roomName);

  if (this.memory.locations) {
    for (let locationType in this.memory.locations) {
      let positions = this.memory.locations[locationType];
      if (!debugSymbols[locationType]) continue;

      for (let posName in positions) {
        let pos = utilities.decodePosition(posName);

        visual.text(debugSymbols[locationType], pos.x, pos.y);
      }
    }
  }
};

/**
 * Gives a the roomplanner control over a room, or takes it away.
 */
RoomPlanner.prototype.controlRoom = function (giveControl) {
  this.memory.controlRoom = giveControl;
};

/**
 *
 */
RoomPlanner.prototype.tryBuild = function (pos, structureType, roomConstructionSites) {
  // Check if there's a structure here already.
  let structures = pos.lookFor(LOOK_STRUCTURES);
  for (let i in structures) {
    if (structures[i].structureType == structureType) {
      // Structure is here, continue.
      return true;
    }
  }

  // Check if there's a construction site here already.
  let sites = pos.lookFor(LOOK_CONSTRUCTION_SITES);
  for (let i in sites) {
    if (sites[i].structureType == structureType) {
      // Structure is being built, wait until finished.
      return false;
    }
  }

  if (this.newStructures + roomConstructionSites.length < 5 && _.size(Game.constructionSites) < MAX_CONSTRUCTION_SITES * 0.9) {
    if (pos.createConstructionSite(structureType) == OK) {
      this.newStructures++;
      // Structure is being built, wait until finished.
      return false;
    }

    // Some other structure is blocking. Building logic should continue for now so it might be moved.
    return true;
  }

  // We can't build anymore in this room right now.
  return false;
};

/**
 * Allows this room planner to give commands in controlled rooms.
 */
RoomPlanner.prototype.runLogic = function () {
  if (Game.cpu.bucket < 3500) return;
  if (!this.memory.controlRoom) return;
  if (!this.memory.locations || !this.memory.plannerVersion || this.memory.plannerVersion != this.roomPlannerVersion) {
    if (Game.cpu.getUsed() < 100) {
      this.placeFlags();
      this.memory.plannerVersion = this.roomPlannerVersion;
    }
    return;
  }
  if (Game.time % 100 != 3 && !this.memory.runNextTick) return;
  delete this.memory.runNextTick;

  var roomConstructionSites = this.room.find(FIND_MY_CONSTRUCTION_SITES);
  var roomStructures = this.room.find(FIND_STRUCTURES);
  this.newStructures = 0;
  let doneBuilding = true;

  // Make sure all current spawns have been built.
  var roomSpawns = _.filter(roomStructures, (structure) => structure.structureType == STRUCTURE_SPAWN);
  var roomSpawnSites = _.filter(roomConstructionSites, (site) => site.structureType == STRUCTURE_SPAWN);

  // Make sure spawns are built in the right place, remove otherwise.
  delete this.memory.hasMisplacedSpawn;
  if (roomSpawns.length == CONTROLLER_STRUCTURES[STRUCTURE_SPAWN][this.room.controller.level] && roomConstructionSites.length == 0) {
    for (let i = 0; i < roomSpawns.length; i++) {
      let spawn = roomSpawns[i];
      if (this.memory.locations.spawn && !this.memory.locations.spawn[utilities.encodePosition(spawn.pos)]) {
        // Only destroy spawn if there are enough resources and builders available.
        let resourcesAvailable = (this.room.storage && this.room.storage.store.energy > CONSTRUCTION_COST[STRUCTURE_SPAWN] * 2 && _.size(this.room.creepsByRole.builder) > 1);
        if ((resourcesAvailable || _.size(roomSpawns) > 1)) {
          // This spawn is misplaced, set a flag for spawning more builders to help.
          if (this.room.storage && this.room.storage.store.energy > CONSTRUCTION_COST[STRUCTURE_SPAWN] * 3) {
            this.memory.hasMisplacedSpawn = true;
          }

          if (!spawn.spawning) {
            let buildPower = 0;
            for (let j in this.room.creepsByRole.builder) {
              let creep = this.room.creepsByRole.builder[j];

              if (creep.ticksToLive) {
                buildPower += creep.memory.body.work * creep.ticksToLive / CREEP_LIFE_TIME;
              }
            }

            if (buildPower > 10) {
              spawn.destroy();
              this.memory.runNextTick = true;
              // Only kill of one spawn at a time, it should be rebuilt right away next tick!
              return;
            }
          }
        }

        // No need to check for another misplaced spawn, it won't be moved either.
        break;
      }
    }
  }
  else if (roomSpawns.length + roomSpawnSites.length < CONTROLLER_STRUCTURES[STRUCTURE_SPAWN][this.room.controller.level]) {
    for (let posName in this.memory.locations.spawn || []) {
      let pos = utilities.decodePosition(posName);

      if (!this.tryBuild(pos, STRUCTURE_SPAWN, roomConstructionSites)) {
        doneBuilding = false;
      }
    }
    if (!doneBuilding) return;
  }

  if (this.room.controller.level < 2) return;

  // For bot debugging purposes, remove all roads not part of current room plan.
  var roomRoads = _.filter(roomStructures, (structure) => structure.structureType == STRUCTURE_ROAD);
  for (let i = 0; i < roomRoads.length; i++) {
    let road = roomRoads[i];
    if (!this.memory.locations.road[utilities.encodePosition(road.pos)]) {
      road.destroy();
    }
  }

  // Make sure towers are built in the right place, remove otherwise.
  var roomTowers = _.filter(roomStructures, (structure) => structure.structureType == STRUCTURE_TOWER);
  var roomTowerSites = _.filter(roomConstructionSites, (site) => site.structureType == STRUCTURE_TOWER);
  if (this.memory.locations.tower) {
    for (let i = 0; i < roomTowers.length; i++) {
      let tower = roomTowers[i];
      if (!this.memory.locations.tower[utilities.encodePosition(tower.pos)] && roomTowers.length == CONTROLLER_STRUCTURES[STRUCTURE_TOWER][this.room.controller.level]) {
        tower.destroy();

        // Only kill of one tower for each call of runLogic.
        break;
      }
    }
  }

  // Make sure all current towers have been built.
  if (roomTowers.length + roomTowerSites.length < CONTROLLER_STRUCTURES[STRUCTURE_TOWER][this.room.controller.level]) {
    for (let posName in this.memory.locations.tower || []) {
      let pos = utilities.decodePosition(posName);

      if (!this.tryBuild(pos, STRUCTURE_TOWER, roomConstructionSites)) {
        doneBuilding = false;
      }
    }
    if (!doneBuilding) return;
  }

  // Make sure extensions are built in the right place, remove otherwise.
  var roomExtensions = _.filter(roomStructures, (structure) => structure.structureType == STRUCTURE_EXTENSION);
  var roomExtensionSites = _.filter(roomConstructionSites, (site) => site.structureType == STRUCTURE_EXTENSION);
  for (let i = 0; i < roomExtensions.length; i++) {
    let extension = roomExtensions[i];
    if (this.memory.locations.extension && !this.memory.locations.extension[utilities.encodePosition(extension.pos)] && roomExtensions.length > CONTROLLER_STRUCTURES[STRUCTURE_EXTENSION][this.room.controller.level] - 5) {
      extension.destroy();

      // Only kill of one extension for each call of runLogic, it takes a while to rebuild anyway.
      break;
    }
  }

  // Make sure all current extensions have been built.
  if (roomExtensions.length + roomExtensionSites.length < CONTROLLER_STRUCTURES[STRUCTURE_EXTENSION][this.room.controller.level]) {
    for (let posName in this.memory.locations.extension || []) {
      let pos = utilities.decodePosition(posName);

      if (!this.tryBuild(pos, STRUCTURE_EXTENSION, roomConstructionSites)) {
        doneBuilding = false;
      }
    }
    if (!doneBuilding) return;
  }

  // Build storage ASAP.
  if (CONTROLLER_STRUCTURES[STRUCTURE_STORAGE][this.room.controller.level] > 0) {
    for (let posName in this.memory.locations['storage'] || []) {
      let pos = utilities.decodePosition(posName);

      if (!this.tryBuild(pos, STRUCTURE_STORAGE, roomConstructionSites)) {
        doneBuilding = false;
      }
    }
    if (!doneBuilding) return;
  }

  // Also build terminal when available.
  if (CONTROLLER_STRUCTURES[STRUCTURE_TERMINAL][this.room.controller.level] > 0) {
    for (let posName in this.memory.locations['terminal'] || []) {
      let pos = utilities.decodePosition(posName);

      if (!this.tryBuild(pos, STRUCTURE_TERMINAL, roomConstructionSites)) {
        doneBuilding = false;
      }
    }
    if (!doneBuilding) return;
  }

  // Make sure links are built in the right place, remove otherwise.
  var roomLinks = _.filter(roomStructures, (structure) => structure.structureType == STRUCTURE_LINK);
  var roomLinkSites = _.filter(roomConstructionSites, (site) => site.structureType == STRUCTURE_LINK);
  if (this.memory.locations.link) {
    for (let i = 0; i < roomLinks.length; i++) {
      let link = roomLinks[i];
      if (!this.memory.locations.link[utilities.encodePosition(link.pos)]) {
        link.destroy();

        // Only kill of one link for each call of runLogic.
        break;
      }
    }
  }

  // Make sure all current links have been built.
  if (roomLinks.length + roomLinkSites.length < CONTROLLER_STRUCTURES[STRUCTURE_LINK][this.room.controller.level]) {
    for (let posName in this.memory.locations.link || []) {
      let pos = utilities.decodePosition(posName);

      if (!this.tryBuild(pos, STRUCTURE_LINK, roomConstructionSites)) {
        doneBuilding = false;
      }
    }
    if (!doneBuilding) return;
  }

  // Build extractor and related container if available.
  if (CONTROLLER_STRUCTURES[STRUCTURE_EXTRACTOR][this.room.controller.level] > 0) {
    for (let posName in this.memory.locations['extractor'] || []) {
      let pos = utilities.decodePosition(posName);

      if (!this.tryBuild(pos, STRUCTURE_EXTRACTOR, roomConstructionSites)) {
        doneBuilding = false;
      }
    }
    for (let posName in this.memory.locations['container.mineral'] || []) {
      let pos = utilities.decodePosition(posName);

      if (!this.tryBuild(pos, STRUCTURE_CONTAINER, roomConstructionSites)) {
        doneBuilding = false;
      }
    }
    if (!doneBuilding) return;
  }

  // At level 2, we can start building containers and roads to sources.
  for (let posName in this.memory.locations['container.source'] || []) {
    let pos = utilities.decodePosition(posName);

    if (!this.tryBuild(pos, STRUCTURE_CONTAINER, roomConstructionSites)) {
      doneBuilding = false;
    }
  }
  if (!doneBuilding) return;

  for (let posName in this.memory.locations['road.source'] || []) {
    let pos = utilities.decodePosition(posName);

    if (!this.tryBuild(pos, STRUCTURE_ROAD, roomConstructionSites)) {
      doneBuilding = false;
    }
  }
  if (!doneBuilding) return;

  // Next priority is a container and road at the controller.
  for (let posName in this.memory.locations['container.controller'] || []) {
    let pos = utilities.decodePosition(posName);

    if (!this.tryBuild(pos, STRUCTURE_CONTAINER, roomConstructionSites)) {
      doneBuilding = false;
    }
  }
  if (!doneBuilding) return;

  for (let posName in this.memory.locations['road.controller'] || []) {
    let pos = utilities.decodePosition(posName);

    if (!this.tryBuild(pos, STRUCTURE_ROAD, roomConstructionSites)) {
      doneBuilding = false;
    }
  }
  if (!doneBuilding) return;

  if (this.room.controller.level < 3) return;

  // At level 3, we can build all remaining roads.
  for (let posName in this.memory.locations['road'] || []) {
    let pos = utilities.decodePosition(posName);

    if (!this.tryBuild(pos, STRUCTURE_ROAD, roomConstructionSites)) {
      doneBuilding = false;
    }
  }
  if (!doneBuilding) return;

  if (this.room.controller.level < 4) return;

  // Make sure all requested ramparts are built.
  var wallsBuilt = true;

  for (let posName in this.memory.locations.rampart || []) {
    let pos = utilities.decodePosition(posName);

    let found = false;
    // Check if there's a rampart here already.
    let structures = pos.lookFor(LOOK_STRUCTURES);
    for (let i in structures) {
      if (structures[i].structureType == STRUCTURE_RAMPART) {
        found = true;

        if (structures[i].hits < 500000) {
          wallsBuilt = false;
        }
        break;
      }
    }

    // Check if there's a construction site here already.
    let sites = pos.lookFor(LOOK_CONSTRUCTION_SITES);
    for (let i in sites) {
      if (sites[i].structureType == STRUCTURE_RAMPART) {
        found = true;
        break;
      }
    }

    if (!found) {
      wallsBuilt = false;

      if (this.newStructures + roomConstructionSites.length < 5 && _.size(Game.constructionSites) < MAX_CONSTRUCTION_SITES * 0.8) {
        if (pos.createConstructionSite(STRUCTURE_RAMPART) == OK) {
          this.newStructures++;
        }
      }
    }
  }

  if (!wallsBuilt) return;
  new Game.logger('room plan', this.roomName).debug('walls are finished');

  // Slate all unmanaged walls and ramparts for deconstruction.
  var unwantedDefenses = this.room.find(FIND_STRUCTURES, {
    filter: (structure) => {
      if (structure.structureType == STRUCTURE_WALL) return true;
      if (structure.structureType == STRUCTURE_RAMPART) {
        // Keep rampart if it is one we have placed.
        let pos = utilities.encodePosition(structure.pos);
        if (this.memory.locations.rampart[pos]) return false;

        // Keep rampart if anything important is below it.
        let structures = structure.pos.lookFor(LOOK_STRUCTURES);
        for (let i in structures) {
          if (structures[i].structureType != STRUCTURE_RAMPART && structures[i].structureType != STRUCTURE_ROAD) {
            return false;
          }
        }
        return true;
      }
      return false;
    }
  });

  if (!this.memory.dismantle) {
    this.memory.dismantle = {};
  }
  for (let i in unwantedDefenses) {
    this.memory.dismantle[unwantedDefenses[i].id] = 1;
  }

  // Make sure labs are built in the right place, remove otherwise.
  var roomLabs = _.filter(roomStructures, (structure) => structure.structureType == STRUCTURE_LAB);
  var roomLabSites = _.filter(roomConstructionSites, (site) => site.structureType == STRUCTURE_LAB);
  for (let i = 0; i < roomLabs.length; i++) {
    let lab = roomLabs[i];
    if (!this.memory.locations.lab[utilities.encodePosition(lab.pos)] && roomLabs.length == CONTROLLER_STRUCTURES[STRUCTURE_LAB][this.room.controller.level]) {
      lab.destroy();

      // Only kill of one lab at a time to rebuild.
      break;
    }
  }

  // Make sure all current labs have been built.
  if (roomLabs.length + roomLabSites.length < CONTROLLER_STRUCTURES[STRUCTURE_LAB][this.room.controller.level]) {
    for (let posName in this.memory.locations.lab || []) {
      let pos = utilities.decodePosition(posName);

      if (!this.tryBuild(pos, STRUCTURE_LAB, roomConstructionSites)) {
        doneBuilding = false;
      }
    }
    if (!doneBuilding) return;
  }
};

/**
 * Decides whether a dismantler is needed in the current room.
 */
RoomPlanner.prototype.needsDismantling = function () {
  if (!this.memory.controlRoom) return false;
  if (_.size(this.memory.dismantle) > 0) {
    return true;
  }
  return false;
};

/**
 * Decides on a structure that needs to be dismantled.
 */
RoomPlanner.prototype.getDismantleTarget = function () {
  if (!this.needsDismantling()) return null;

  for (let id in this.memory.dismantle) {
    let structure = Game.getObjectById(id);
    if (structure) {
      // If there's a rampart on it, dismantle the rampart first if requested, or just destroy the building immediately.
      let structures = structure.pos.lookFor(LOOK_STRUCTURES);
      let innocentRampartFound = false;
      for (let i in structures) {
        if (structures[i].structureType == STRUCTURE_RAMPART) {
          if (this.memory.dismantle[structures[i].id]) {
            return structures[i];
          }
          else {
            structure.destroy();
            innocentRampartFound = true;
            break;
          }
        }
      }

      if (!innocentRampartFound) {
        return structure;
      }
    }
    else {
      delete this.memory.dismantle[id];
    }
  }

  return null;
};

/**
 * Decides whether a structure is supposed to be dismantled.
 */
Structure.prototype.needsDismantling = function () {
  if (!this.room.roomPlanner.needsDismantling()) return false;

  if (this.room.roomPlanner.memory.dismantle && this.room.roomPlanner.memory.dismantle[this.id]) {
    return true;
  }
  return false;
};

/**
 * Places a room planner flag of a certain type.
 */
RoomPlanner.prototype.placeFlag = function (pos, flagType, visible) {
  let posName = utilities.encodePosition(pos);

  if (!this.memory.locations) {
    this.memory.locations = {};
  }
  if (!this.memory.locations[flagType]) {
    this.memory.locations[flagType] = {};
  }
  this.memory.locations[flagType][posName] = 1;

  if (visible) {
    let flagName = 'RP:' + posName + ':' + flagType;

    let color = COLOR_WHITE;
    let color2 = COLOR_WHITE;

    if (flagType == 'wall') {
      color = COLOR_GREY;
      color2 = COLOR_GREY;
    }
    else if (flagType == 'rampart') {
      color = COLOR_GREY;
      color2 = COLOR_GREEN;
    }
    else if (flagType == 'road') {
      color = COLOR_GREY;
      color2 = COLOR_WHITE;
    }
    else if (flagType == 'exit') {
      color = COLOR_RED;
      color2 = COLOR_RED;
    }
    else if (flagType == 'center') {
      color = COLOR_GREEN;
      color2 = COLOR_GREEN;
    }
    else if (flagType == 'test') {
      color = COLOR_YELLOW;
      color2 = COLOR_GREY;
    }

    if (Game.flags[flagName]) {
      Game.flags[flagName].setColor(color, color2);
    }
    else {
      pos.createFlag(flagName, color, color2);
    }
  }
};

/**
 * Generates CostMatrixes needed for structure placement.
 */
RoomPlanner.prototype.generateDistanceMatrixes = function () {
  var matrix = new PathFinder.CostMatrix();
  var exitMatrix = new PathFinder.CostMatrix();

  for (let x = 0; x < 50; x++) {
    for (let y = 0; y < 50; y++) {
      let terrain = Game.map.getTerrainAt(x, y, this.roomName);

      if (terrain == 'wall') {
        matrix.set(x, y, 255);
        exitMatrix.set(x, y, 255);
        continue;
      }

      if (x == 0 || x == 49 || y == 0 || y == 49) {
        exitMatrix.set(x, y, 1);
      }

      let found = false;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          let ax = (x + dx < 0 ? 0 : (x + dx > 49 ? 49 : x + dx));
          let ay = (y + dy < 0 ? 0 : (y + dy > 49 ? 49 : y + dy));

          if ((ax != 0 || ay != 0) && Game.map.getTerrainAt(ax, ay, this.roomName) == 'wall') {
            matrix.set(x, y, 1);
            found = true;
            break;
          }
        }
        if (found) break;
      }
    }
  }

  let currentDistance = 1;
  let done = false;
  while (!done) {
    done = true;

    for (let x = 0; x < 50; x++) {
      for (let y = 0; y < 50; y++) {
        if (matrix.get(x, y) == 0) {
          let found = false;
          for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
              let ax = (x + dx < 0 ? 0 : (x + dx > 49 ? 49 : x + dx));
              let ay = (y + dy < 0 ? 0 : (y + dy > 49 ? 49 : y + dy));

              if ((ax != 0 || ay != 0) && matrix.get(ax, ay) == currentDistance) {
                matrix.set(x, y, currentDistance + 1);
                done = false;
                found = true;
                break;
              }
            }
            if (found) break;
          }
        }
        if (exitMatrix.get(x, y) == 0) {
          let found = false;
          for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
              let ax = (x + dx < 0 ? 0 : (x + dx > 49 ? 49 : x + dx));
              let ay = (y + dy < 0 ? 0 : (y + dy > 49 ? 49 : y + dy));

              if ((ax != 0 || ay != 0) && exitMatrix.get(ax, ay) == currentDistance) {
                exitMatrix.set(x, y, currentDistance + 1);
                done = false;
                found = true;
                break;
              }
            }
            if (found) break;
          }
        }
      }
    }

    currentDistance++;
  }

  this.memory.wallDistanceMatrix = matrix.serialize();
  this.memory.exitDistanceMatrix = exitMatrix.serialize();
};

/**
 * Find positions from where many exit tiles are in short range.
 */
RoomPlanner.prototype.findTowerPositions = function (exits, matrix) {
  let positions = {
    N: {count: 0, tiles: []},
    E: {count: 0, tiles: []},
    S: {count: 0, tiles: []},
    W: {count: 0, tiles: []},
  };

  for (let x = 5; x < 45; x++) {
    for (let y = 5; y < 45; y++) {
      if (x != 5 && x != 44 && y != 5 && y != 44) continue;
      if (matrix.get(x, y) != 0) continue;
      if (Game.map.getTerrainAt(x, y, this.roomName) == 'wall') continue;
      let score = 0;

      let tileDir = 'S';
      if (x == 5) tileDir = 'W';
      if (x == 44) tileDir = 'E';
      if (y == 5) tileDir = 'N';

      if (_.size(exits[tileDir]) == 0) continue;

      for (let dir in exits) {
        for (let i in exits[dir]) {
          score += 1 / exits[dir][i].getRangeTo(x, y);
        }
      }

      positions[tileDir].tiles.push({
        score: score,
        pos: new RoomPosition(x, y, this.roomName),
      });
    }
  }

  return positions;
};

/**
 * Makes plans for a room and place flags to visualize.
 */
RoomPlanner.prototype.placeFlags = function (visible) {
  var start = Game.cpu.getUsed();

  if (!this.memory.wallDistanceMatrix) {
    this.generateDistanceMatrixes();
    return;
  }

  // Reset location memory, to be replaced with new flags.
  this.memory.locations = {};
  let maxRoomLevel = 8;

  let wallDistanceMatrix = PathFinder.CostMatrix.deserialize(this.memory.wallDistanceMatrix);
  let exitDistanceMatrix = PathFinder.CostMatrix.deserialize(this.memory.exitDistanceMatrix);

  // Prepare CostMatrix and exit points.
  var matrix = new PathFinder.CostMatrix();
  let exits = {
    N: [],
    S: [],
    W: [],
    E: [],
  };
  let walls = [];
  let roads = [];
  let centerPositions = [];
  for (let x = 0; x < 50; x++) {
    for (let y = 0; y < 50; y++) {
      let terrain = Game.map.getTerrainAt(x, y, this.roomName);

      // Treat exits as unwalkable for in-room pathfinding.
      if (x == 0 || y == 0 || x == 49 || y == 49) {
        if (terrain != 'wall') {
          if (x == 0) {
            exits.W.push(new RoomPosition(x, y, this.roomName));
          }
          if (x == 49) {
            exits.E.push(new RoomPosition(x, y, this.roomName));
          }
          if (y == 0) {
            exits.N.push(new RoomPosition(x, y, this.roomName));
          }
          if (y == 49) {
            exits.S.push(new RoomPosition(x, y, this.roomName));
          }
        }

        matrix.set(x, y, 255);
        continue;
      }

      // Avoid pathfinding close to walls to keep space for dodging and building / wider roads.
      let wallDistance = wallDistanceMatrix.get(x, y);
      let exitDistance = exitDistanceMatrix.get(x, y);

      if (wallDistance == 1) {
        matrix.set(x, y, 10);
      }

      if (wallDistance >= 4 && wallDistance < 255 && exitDistance > 8) {
        centerPositions.push(new RoomPosition(x, y, this.roomName));
      }

      if (exitDistance >= 2 && exitDistance <= 5) {
        // Avoid area near exits and room walls to not get shot at.
        matrix.set(x, y, 10);
      }
      if (exitDistance == 3) {
        matrix.set(x, y, 10);
        walls.push(new RoomPosition(x, y, this.roomName));
      }
    }
  }

  // Decide where exit regions are and where walls should be placed.
  let exitCenters = {};
  for (let dir in exits) {
    exitCenters[dir] = [];

    let startPos = null;
    let prevPos = null;
    for (let i in exits[dir]) {
      let pos = exits[dir][i];

      if (!startPos) {
        startPos = pos;
      }
      if (prevPos && pos.getRangeTo(prevPos) > 1) {
        // New exit block started.
        let middlePos = new RoomPosition(Math.ceil((prevPos.x + startPos.x) / 2), Math.ceil((prevPos.y + startPos.y) / 2), this.roomName);
        exitCenters[dir].push(middlePos);

        startPos = pos;
      }
      prevPos = pos;
    }

    if (startPos) {
      // Finish last wall run.
      let middlePos = new RoomPosition(Math.ceil((prevPos.x + startPos.x) / 2), Math.ceil((prevPos.y + startPos.y) / 2), this.roomName);
      exitCenters[dir].push(middlePos);
    }

    for (let i in exitCenters[dir]) {
      this.placeFlag(exitCenters[dir][i], 'exit', visible);
    }
  }

  for (let i in walls) {
    this.placeFlag(walls[i], 'rampart', visible);
  }

  // Decide where room center should be by averaging exit positions.
  let cx = 27;
  let cy = 27;
  for (let dir in exitCenters) {
    for (let i in exitCenters[dir]) {
      if(exitCenters[dir][i].x > cx) {
        cx -= 1;
      }
      else {
        cx += 1;
      }
      
      if(exitCenters[dir][i].y > cy) {
        cy -= 1;
      }
      else {
        cy += 1;
      }
    }
  }

  // Find closest position with distance from walls around there.
  let roomCenter = (new RoomPosition(cx, cy, this.roomName)).findClosestByRange(centerPositions);
  this.placeFlag(roomCenter, 'center', visible);

  // Center is accessible via the 4 cardinal directions.
  let centerEntrances = [
    new RoomPosition(roomCenter.x + 2, roomCenter.y, this.roomName),
    new RoomPosition(roomCenter.x - 2, roomCenter.y, this.roomName),
    new RoomPosition(roomCenter.x, roomCenter.y + 2, this.roomName),
    new RoomPosition(roomCenter.x, roomCenter.y - 2, this.roomName),
  ];

  // Find paths from each exit towards the room center for making roads.
  for (let dir in exitCenters) {
    for (let i in exitCenters[dir]) {
      this.scanAndAddRoad(exitCenters[dir][i], centerEntrances, matrix, roads);
    }
  }

  let tileFreeForBuilding = function (x, y, allowRoads) {
    if (x < 2 || x > 47 || y < 2 || y > 47) return false;

    let matrixValue = matrix.get(x, y);
    if (matrixValue > 100) return false;
    if (wallDistanceMatrix.get(x, y) > 100) return false;
    if (matrixValue == 10 && wallDistanceMatrix.get(x, y) == 1) return true;
    if (matrixValue > 1) return false;
    if (matrixValue == 1 && !allowRoads) return false;

    return true;
  }

  let planner = this;
  let placeLink = function (sourceRoads) {
    let linkPlaced = false;
    for (let i in sourceRoads) {
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (dx == 0 && dy == 0) continue;

          if (tileFreeForBuilding(sourceRoads[i].x + dx, sourceRoads[i].y + dy)) {
            planner.placeFlag(new RoomPosition(sourceRoads[i].x + dx, sourceRoads[i].y + dy, sourceRoads[i].roomName), 'link', visible);
            matrix.set(sourceRoads[i].x + dx, sourceRoads[i].y + dy, 255);
            linkPlaced = true;
            break;
          }
        }
        if (linkPlaced) break;
      }
      if (linkPlaced) break;
    }
  }

  let placeContainer = function (sourceRoads, containerType) {
    let targetPos = null;
    if (tileFreeForBuilding(sourceRoads[1].x, sourceRoads[1].y, true)) {
      targetPos = sourceRoads[1];
    }
    else if (tileFreeForBuilding(sourceRoads[0].x, sourceRoads[0].y, true)) {
      targetPos = sourceRoads[0];
    }
    else {
      for (let i in sourceRoads) {
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            if (i > 3) continue;

            if (tileFreeForBuilding(sourceRoads[i].x + dx, sourceRoads[i].y + dy, true)) {
              targetPos = new RoomPosition(sourceRoads[i].x + dx, sourceRoads[i].y + dy, sourceRoads[i].roomName);
              break;
            }
          }
          if (targetPos) break;
        }
        if (targetPos) break;
      }
    }

    if (targetPos) {
      planner.placeFlag(targetPos, 'container' + (containerType ? '.' + containerType : ''), visible);
      matrix.set(targetPos.x, targetPos.y, 1);
    }
  }

  if (this.room) {
    // @todo Have intelManager save locations (not just IDs) of sources, minerals and controller, so we don't need room access here.
    // We also save which road belongs to which path, so we can selectively autobuild roads during room bootstrap instead of building all roads at once.
    if (this.room.controller) {
      let controllerRoads = this.scanAndAddRoad(this.room.controller.pos, centerEntrances, matrix, roads);
      for (let i in controllerRoads) {
        if (i == 0) continue;
        this.placeFlag(controllerRoads[i], 'road.controller', visible);
      }
      placeContainer(controllerRoads, 'controller');

      // Place a link near controller, but off the calculated path.
      placeLink(controllerRoads);
    }

    if (this.room.mineral) {
      this.placeFlag(this.room.mineral.pos, 'extractor', visible);
      let mineralRoads = this.scanAndAddRoad(this.room.mineral.pos, centerEntrances, matrix, roads);
      for (let i in mineralRoads) {
        this.placeFlag(mineralRoads[i], 'road.mineral', visible);
      }
      placeContainer(mineralRoads, 'mineral');
    }

    if (this.room.sources) {
      for (let i in this.room.sources) {
        let sourceRoads = this.scanAndAddRoad(this.room.sources[i].pos, centerEntrances, matrix, roads);
        for (let i in sourceRoads) {
          this.placeFlag(sourceRoads[i], 'road.source', visible);
        }
        placeContainer(sourceRoads, 'source');

        // Place a link near sources, but off the calculated path.
        placeLink(sourceRoads);
      }
    }
  }

  for (let i in roads) {
    this.placeFlag(roads[i], 'road', visible);
  }

  // Fill center cross with roads.
  this.placeFlag(new RoomPosition(roomCenter.x - 1, roomCenter.y, this.roomName), 'road', visible);
  matrix.set(roomCenter.x - 1, roomCenter.y, 1);
  this.placeFlag(new RoomPosition(roomCenter.x + 1, roomCenter.y, this.roomName), 'road', visible);
  matrix.set(roomCenter.x + 1, roomCenter.y, 1);
  this.placeFlag(new RoomPosition(roomCenter.x, roomCenter.y - 1, this.roomName), 'road', visible);
  matrix.set(roomCenter.x, roomCenter.y - 1, 1);
  this.placeFlag(new RoomPosition(roomCenter.x, roomCenter.y + 1, this.roomName), 'road', visible);
  matrix.set(roomCenter.x, roomCenter.y + 1, 1);
  this.placeFlag(new RoomPosition(roomCenter.x, roomCenter.y, this.roomName), 'road', visible);
  matrix.set(roomCenter.x, roomCenter.y, 1);

  // Mark center buildings for construction.
  this.placeFlag(new RoomPosition(roomCenter.x - 1, roomCenter.y + 1, this.roomName), 'storage', visible);
  matrix.set(roomCenter.x - 1, roomCenter.y + 1, 255);
  this.placeFlag(new RoomPosition(roomCenter.x - 1, roomCenter.y - 1, this.roomName), 'terminal', visible);
  matrix.set(roomCenter.x - 1, roomCenter.y - 1, 255);
  this.placeFlag(new RoomPosition(roomCenter.x + 1, roomCenter.y + 1, this.roomName), 'lab', visible);
  matrix.set(roomCenter.x + 1, roomCenter.y + 1, 255);
  this.placeFlag(new RoomPosition(roomCenter.x + 1, roomCenter.y - 1, this.roomName), 'link', visible);
  matrix.set(roomCenter.x + 1, roomCenter.y - 1, 255);

  // Flood fill from the center to place buildings that need to be accessible.
  var openList = {};
  openList[utilities.encodePosition(roomCenter)] = {range: 0};
  var closedList = {};
  var buildingsPlaced = false;
  var bayCount = 0;
  var helperPlaced = false;
  while (!buildingsPlaced && _.size(openList) > 0) {
    let minDist = null;
    let nextPos = null;
    for (let posName in openList) {
      let info = openList[posName];
      let pos = utilities.decodePosition(posName);
      if (!minDist || info.range < minDist) {
        minDist = info.range;
        nextPos = pos;
      }
    }

    if (!nextPos) {
      break;
    }
    delete openList[utilities.encodePosition(nextPos)];
    closedList[utilities.encodePosition(nextPos)] = true;

    // Add unhandled adjacent tiles to open list.
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx == 0 && dy == 0) continue;
        let pos = new RoomPosition(nextPos.x + dx, nextPos.y + dy, this.roomName);
        if (pos.x < 1 || pos.x > 48 || pos.y < 1 || pos.y > 48) continue;

        // Only build on valid terrain.
        if (wallDistanceMatrix.get(pos.x, pos.y) > 100) continue;

        // Don't build too close to exits.
        if (exitDistanceMatrix.get(pos.x, pos.y) < 5) continue;

        let posName = utilities.encodePosition(pos);
        if (openList[posName] || closedList[posName]) continue;
        //console.log('openList', pos.x, pos.y);
        openList[posName] = {range: minDist + 1};
      }
    }

    // Handle current position.
    if (nextPos.getRangeTo(roomCenter) < 3) continue;

    if (!this.memory.locations.spawn || _.size(this.memory.locations.spawn) < CONTROLLER_STRUCTURES.spawn[maxRoomLevel]) {
      // Try placing spawns.
      if (!tileFreeForBuilding(nextPos.x, nextPos.y)) continue;
      if (!tileFreeForBuilding(nextPos.x - 1, nextPos.y, true)) continue;
      if (!tileFreeForBuilding(nextPos.x + 1, nextPos.y, true)) continue;
      if (!tileFreeForBuilding(nextPos.x, nextPos.y - 1, true)) continue;
      if (!tileFreeForBuilding(nextPos.x, nextPos.y + 1, true)) continue;

      this.placeFlag(new RoomPosition(nextPos.x, nextPos.y, this.roomName), 'spawn', visible);
      matrix.set(nextPos.x, nextPos.y, 255);
      this.placeFlag(new RoomPosition(nextPos.x - 1, nextPos.y, this.roomName), 'road', visible);
      matrix.set(nextPos.x - 1, nextPos.y, 1);
      this.placeFlag(new RoomPosition(nextPos.x + 1, nextPos.y, this.roomName), 'road', visible);
      matrix.set(nextPos.x + 1, nextPos.y, 1);
      this.placeFlag(new RoomPosition(nextPos.x, nextPos.y - 1, this.roomName), 'road', visible);
      matrix.set(nextPos.x, nextPos.y - 1, 1);
      this.placeFlag(new RoomPosition(nextPos.x, nextPos.y + 1, this.roomName), 'road', visible);
      matrix.set(nextPos.x, nextPos.y + 1, 1);

      new Game.logger('room plan', this.roomName).debug('Placing new spawn at', nextPos);
    }
    else if (!helperPlaced) {
      // Place parking spot for helper creep.
      if (!tileFreeForBuilding(nextPos.x, nextPos.y)) continue;

      let flagKey = 'Helper:' + nextPos.roomName;
      if (Game.flags[flagKey]) {
        Game.flags[flagKey].setPosition(nextPos);
      }
      else {
        nextPos.createFlag(flagKey);
      }
      this.placeFlag(nextPos, 'road', visible);
      matrix.set(nextPos.x, nextPos.y, 255);
      helperPlaced = true;
    }
    else if (!this.memory.locations.extension || _.size(this.memory.locations.extension) < CONTROLLER_STRUCTURES.extension[maxRoomLevel]) {
      if (!tileFreeForBuilding(nextPos.x, nextPos.y)) continue;
      if (!tileFreeForBuilding(nextPos.x - 1, nextPos.y)) continue;
      if (!tileFreeForBuilding(nextPos.x + 1, nextPos.y)) continue;
      if (!tileFreeForBuilding(nextPos.x, nextPos.y - 1)) continue;
      if (!tileFreeForBuilding(nextPos.x, nextPos.y + 1)) continue;
      if (!tileFreeForBuilding(nextPos.x - 1, nextPos.y - 1)) continue;
      if (!tileFreeForBuilding(nextPos.x + 1, nextPos.y - 1)) continue;
      if (!tileFreeForBuilding(nextPos.x - 1, nextPos.y + 1)) continue;
      if (!tileFreeForBuilding(nextPos.x + 1, nextPos.y + 1)) continue;

      // Leave a road to room center.
      let extensionRoads = this.scanAndAddRoad(nextPos, centerEntrances, matrix, roads);
      for (let i in extensionRoads) {
        this.placeFlag(extensionRoads[i], 'road', visible);
        matrix.set(extensionRoads[i].x, extensionRoads[i].y, 1);
      }
      // Make sure there is a road in the center of the bay.
      this.placeFlag(nextPos, 'road', visible);
      matrix.set(nextPos.x, nextPos.y, 1);

      // Fill other unused spots with extensions.
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (!tileFreeForBuilding(nextPos.x + dx, nextPos.y + dy)) continue;

          this.placeFlag(new RoomPosition(nextPos.x + dx, nextPos.y + dy, nextPos.roomName), 'extension', visible);
          matrix.set(nextPos.x + dx, nextPos.y + dy, 255);
        }
      }

      // Place a flag to mark this bay.
      let flagKey = 'Bay:' + nextPos.roomName + ':' + bayCount;
      if (Game.flags[flagKey]) {
        Game.flags[flagKey].setPosition(nextPos);
      }
      else {
        nextPos.createFlag(flagKey);
      }
      bayCount++;
    }
    else if (!this.memory.locations.lab || _.size(this.memory.locations.lab) < CONTROLLER_STRUCTURES.lab[maxRoomLevel]) {
      // @todo Dynamically generate lab layout for servers where 10 labs is not the max.
      // @todo Allow rotating this blueprint for better access.
      if (!tileFreeForBuilding(nextPos.x, nextPos.y)) continue;
      if (!tileFreeForBuilding(nextPos.x - 1, nextPos.y)) continue;
      if (!tileFreeForBuilding(nextPos.x + 1, nextPos.y)) continue;
      if (!tileFreeForBuilding(nextPos.x, nextPos.y - 1)) continue;
      if (!tileFreeForBuilding(nextPos.x, nextPos.y + 1)) continue;
      if (!tileFreeForBuilding(nextPos.x - 1, nextPos.y - 1)) continue;
      if (!tileFreeForBuilding(nextPos.x + 1, nextPos.y - 1)) continue;
      if (!tileFreeForBuilding(nextPos.x - 1, nextPos.y + 1)) continue;
      if (!tileFreeForBuilding(nextPos.x + 1, nextPos.y + 1)) continue;
      if (!tileFreeForBuilding(nextPos.x - 1, nextPos.y + 2)) continue;
      if (!tileFreeForBuilding(nextPos.x, nextPos.y + 2)) continue;
      if (!tileFreeForBuilding(nextPos.x + 1, nextPos.y + 2)) continue;

      // Make sure we can get a road back to storage.
      let testMatrix = matrix.clone();
      testMatrix.set(nextPos.x - 1, nextPos.y - 1, 255);
      testMatrix.set(nextPos.x, nextPos.y - 1, 255);
      testMatrix.set(nextPos.x + 1, nextPos.y - 1, 255);
      testMatrix.set(nextPos.x - 1, nextPos.y, 255);
      testMatrix.set(nextPos.x, nextPos.y, 1); // Road.
      testMatrix.set(nextPos.x + 1, nextPos.y, 255);
      testMatrix.set(nextPos.x - 1, nextPos.y + 1, 1); // Road.
      testMatrix.set(nextPos.x, nextPos.y + 1, 255);
      testMatrix.set(nextPos.x + 1, nextPos.y + 1, 1); // Road.
      testMatrix.set(nextPos.x - 1, nextPos.y + 2, 255);
      testMatrix.set(nextPos.x, nextPos.y + 2, 255);
      testMatrix.set(nextPos.x + 1, nextPos.y + 2, 255);
      let path = this.scanAndAddRoad(nextPos, centerEntrances, testMatrix, []);

      if (_.size(path) == 0) {
        // This location is not reasonable.
        continue;
      }

      // Add buildings and roads for real.
      matrix.set(nextPos.x - 1, nextPos.y - 1, 255);
      this.placeFlag(new RoomPosition(nextPos.x - 1, nextPos.y - 1, nextPos.roomName), 'lab', visible);
      matrix.set(nextPos.x, nextPos.y - 1, 255);
      this.placeFlag(new RoomPosition(nextPos.x, nextPos.y - 1, nextPos.roomName), 'lab', visible);
      matrix.set(nextPos.x + 1, nextPos.y - 1, 255);
      this.placeFlag(new RoomPosition(nextPos.x + 1, nextPos.y - 1, nextPos.roomName), 'lab', visible);
      matrix.set(nextPos.x - 1, nextPos.y, 255);
      this.placeFlag(new RoomPosition(nextPos.x - 1, nextPos.y, nextPos.roomName), 'lab', visible);
      matrix.set(nextPos.x, nextPos.y, 1); // Road.
      this.placeFlag(new RoomPosition(nextPos.x, nextPos.y, nextPos.roomName), 'road', visible);
      matrix.set(nextPos.x + 1, nextPos.y, 255);
      this.placeFlag(new RoomPosition(nextPos.x + 1, nextPos.y, nextPos.roomName), 'lab', visible);
      matrix.set(nextPos.x - 1, nextPos.y + 1, 1); // Road.
      this.placeFlag(new RoomPosition(nextPos.x - 1, nextPos.y + 1, nextPos.roomName), 'road', visible);
      matrix.set(nextPos.x, nextPos.y + 1, 255);
      this.placeFlag(new RoomPosition(nextPos.x, nextPos.y + 1, nextPos.roomName), 'lab', visible);
      matrix.set(nextPos.x + 1, nextPos.y + 1, 1); // Road.
      this.placeFlag(new RoomPosition(nextPos.x + 1, nextPos.y + 1, nextPos.roomName), 'road', visible);
      matrix.set(nextPos.x - 1, nextPos.y + 2, 255);
      this.placeFlag(new RoomPosition(nextPos.x - 1, nextPos.y + 2, nextPos.roomName), 'lab', visible);
      matrix.set(nextPos.x, nextPos.y + 2, 255);
      this.placeFlag(new RoomPosition(nextPos.x, nextPos.y + 2, nextPos.roomName), 'lab', visible);
      matrix.set(nextPos.x + 1, nextPos.y + 2, 255);
      this.placeFlag(new RoomPosition(nextPos.x + 1, nextPos.y + 2, nextPos.roomName), 'lab', visible);
      let labRoads = this.scanAndAddRoad(nextPos, centerEntrances, matrix, roads);
      for (let i in labRoads) {
        this.placeFlag(labRoads[i], 'road', visible);
        matrix.set(labRoads[i].x, labRoads[i].y, 1);
      }
    }
    else {
      buildingsPlaced = true;
    }
  }

  // Remove other bay flags in room that might be left over.
  for (let i = bayCount; i < 30; i++) {
    let flagKey = 'Bay:' + this.roomName + ':' + i;
    if (Game.flags[flagKey]) {
      Game.flags[flagKey].remove();
    }
  }

  // Determine where towers should be.
  let positions = this.findTowerPositions(exits, matrix);
  while (_.size(this.memory.locations.tower) < CONTROLLER_STRUCTURES.tower[maxRoomLevel]) {
    let info = null;
    let bestDir = null;
    for (let dir in positions) {
      for (let i in positions[dir].tiles) {
        let tile = positions[dir].tiles[i];
        if (!info || positions[bestDir].count > positions[dir].count || (info.score < tile.score && positions[bestDir].count == positions[dir].count)) {
          info = tile;
          bestDir = dir;
        }
      }
    }

    if (!info) break;

    info.score = -1;
    positions[bestDir].count++;

    // Also create a road to this tower.
    let towerRoads = this.scanAndAddRoad(info.pos, centerEntrances, matrix, roads);
    for (let i in towerRoads) {
      //if (i == 0) continue;
      this.placeFlag(towerRoads[i], 'road', visible);
      matrix.set(towerRoads[i].x, towerRoads[i].y, 1);
    }

    this.placeFlag(new RoomPosition(info.pos.x, info.pos.y, info.pos.roomName), 'tower', visible);
    matrix.set(info.pos.x + 1, info.pos.y + 2, 255);
  }

  var end = Game.cpu.getUsed();
  console.log('Planning for', this.roomName, 'took', end - start, 'CPU');
};

RoomPlanner.prototype.scanAndAddRoad = function (from, to, matrix, roads) {
  let result = PathFinder.search(from, to, {
    roomCallback: (roomName) => matrix,
    maxRooms: 1,
    plainCost: 2,
    swampCost: 2, // Swamps are more expensive to build roads on, but once a road is on them, creeps travel at the same speed.
    heuristicWeight: 0.9,
  });

  let newRoads = [];
  if (result.path) {
    for (let j in result.path) {
      let pos = result.path[j];
      roads.push(pos);
      newRoads.push(pos);

      // Since we're building a road on this tile anyway, prefer it for future pathfinding.
      matrix.set(pos.x, pos.y, 1);
    }
  }

  return newRoads;
}

/**
 * Clears all flags placed in a room by the room planner.
 */
RoomPlanner.prototype.clearFlags = function () {
  var flags = _.filter(Game.flags, (flag) => flag.pos.roomName == this.roomName && flag.name.startsWith('RP:'));

  for (let i in flags) {
    flags[i].remove();
  }
};

module.exports = RoomPlanner;
