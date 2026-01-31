"use strict";

const util = require('../lib/util');
const { v4: uuidv4 } = require('uuid');
const {getPosition} = require("../lib/entityUtils");
const sat = require('sat');

class Virus {
    constructor(position, radius, mass, config) {
        this.id = uuidv4();
        this.x = position.x;
        this.y = position.y;
        this.radius = radius;
        this.mass = mass;
        this.baseMass = mass; // Store original mass
        this.fill = config.fill;
        this.stroke = config.stroke;
        this.strokeWidth = config.strokeWidth;
        this.feedCount = 0;   // Track how many times fed
        this.speed = 0;       // For moving viruses
        this.direction = null; // Direction when shot
    }

    // Absorb mass from massFood and grow
    absorbMass(massAmount, direction) {
        this.mass += massAmount;
        this.radius = util.massToRadius(this.mass);
        this.feedCount++;
        // Store the last direction from which mass came (for shooting)
        this.lastFeedDirection = direction;
    }

    // Check if virus should split (after 7 feeds in original agar.io)
    shouldSplit(feedsToSplit) {
        return this.feedCount >= feedsToSplit;
    }

    // Reset virus after splitting
    reset() {
        this.mass = this.baseMass;
        this.radius = util.massToRadius(this.mass);
        this.feedCount = 0;
    }

    // Move the virus (when it's been shot)
    move(gameWidth, gameHeight) {
        if (this.speed <= 0 || !this.direction) return;

        const deltaX = this.speed * this.direction.x;
        const deltaY = this.speed * this.direction.y;

        this.speed -= 0.5;
        if (this.speed < 0) {
            this.speed = 0;
        }

        if (!isNaN(deltaY)) {
            this.y += deltaY;
        }
        if (!isNaN(deltaX)) {
            this.x += deltaX;
        }

        // Keep virus within boundaries
        const borderCalc = this.radius + 5;
        if (this.x > gameWidth - borderCalc) this.x = gameWidth - borderCalc;
        if (this.y > gameHeight - borderCalc) this.y = gameHeight - borderCalc;
        if (this.x < borderCalc) this.x = borderCalc;
        if (this.y < borderCalc) this.y = borderCalc;
    }
}

exports.VirusManager = class {
    constructor(virusConfig) {
        this.data = [];
        this.virusConfig = virusConfig;
    }

    pushNew(virus) {
        this.data.push(virus);
    }

    addNew(number) {
        while (number--) {
            var mass = util.randomInRange(this.virusConfig.defaultMass.from, this.virusConfig.defaultMass.to);
            var radius = util.massToRadius(mass);
            var position = getPosition(this.virusConfig.uniformDisposition, radius, this.data);
            var newVirus = new Virus(position, radius, mass, this.virusConfig);
            this.pushNew(newVirus);
        }
    }

    // Create a new virus shot from a parent virus in a specific direction
    spawnFromSplit(parentVirus, direction, shotSpeed) {
        var mass = util.randomInRange(this.virusConfig.defaultMass.from, this.virusConfig.defaultMass.to);
        var radius = util.massToRadius(mass);
        var position = {
            x: parentVirus.x + direction.x * (parentVirus.radius + radius + 5),
            y: parentVirus.y + direction.y * (parentVirus.radius + radius + 5)
        };
        var newVirus = new Virus(position, radius, mass, this.virusConfig);
        newVirus.speed = shotSpeed;
        newVirus.direction = direction;
        this.pushNew(newVirus);
    }

    // Move all viruses that have speed (shot viruses)
    move(gameWidth, gameHeight) {
        for (let virus of this.data) {
            if (virus.speed > 0) {
                virus.move(gameWidth, gameHeight);
            }
        }
    }

    delete(virusCollision) {
        this.data.splice(virusCollision, 1);
    }
};

// Export Virus class for debug spawning
exports.Virus = Virus;
