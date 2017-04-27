var songs = {
    nothing: {
        roles: ['harvester', 'harvester.mineral', 'transporter', 'upgrader', 'repairer', 'builder', 'hauler'],
        lines: [
        ],
    }
};

var roleplay = {

    roomSongs: function() {
        for (var roomNum in Game.rooms) {
            var room = Game.rooms[roomNum];

            if (!room.controller || !room.controller.my) continue;

            if (!room.memory.roleplay) {
                room.memory.roleplay = {};
            }
            if (!room.memory.roleplay.roomSong) {
                room.memory.roleplay.roomSong = {};
            }

            var songMemory = room.memory.roleplay.roomSong;

            if (!songMemory.name) songMemory.name = 'nothing';
            if (!songs[songMemory.name]) continue;
            var song = songs[songMemory.name];

            if (!songMemory.currentBeat) songMemory.currentBeat = 0;
            songMemory.currentBeat++;

            if (songMemory.currentBeat >= song.lines.length) {
                songMemory.currentBeat = 0;
            }

            if (!song.lines[songMemory.currentBeat] || song.lines[songMemory.currentBeat] == '') continue;

            var creeps = room.find(FIND_MY_CREEPS, {
                filter: (creep) => song.roles.includes(creep.memory.role)
            });
            if (creeps.length <= 0) continue;

            var creep = creeps[Math.floor(Math.random() * creeps.length)];

            creep.say(song.lines[songMemory.currentBeat], true);
        }
    }

};

module.exports = roleplay;