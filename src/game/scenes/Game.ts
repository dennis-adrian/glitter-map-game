import { Scene } from "phaser";

// Stand data type — mirrors your Supabase table
interface StandData {
  id: string;
  participant_name: string;
  description: string;
  category: string;
  instagram?: string;
  photo_url?: string;
}

export class Game extends Scene {
  private map!: Phaser.Tilemaps.Tilemap;
  private tileset!: Phaser.Tilemaps.Tileset;
  private floorLayer!: Phaser.Tilemaps.TilemapLayer;
  private structuresLayer!: Phaser.Tilemaps.TilemapLayer; // your "Objects" tile layer

  // Player
  private player!: Phaser.Physics.Arcade.Sprite;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: {
    up: Phaser.Input.Keyboard.Key;
    down: Phaser.Input.Keyboard.Key;
    left: Phaser.Input.Keyboard.Key;
    right: Phaser.Input.Keyboard.Key;
  };

  // Touch movement
  private touchStartX = 0;
  private touchStartY = 0;
  private touchActive = false;
  private touchDeltaX = 0;
  private touchDeltaY = 0;
  private readonly TOUCH_DEADZONE = 12;

  // Stands
  private standsLayer!: Phaser.Tilemaps.ObjectLayer;
  private activeStand: string | null = null;
  private standDataCache: Map<string, StandData> = new Map();

  // UI
  private standPopup!: Phaser.GameObjects.Container;
  private isPopupOpen = false;

  // Constants
  private readonly PLAYER_SPEED = 160;

  constructor() {
    super("Game");
  }

  preload() {
    // Load the map and tileset
    this.load.tilemapTiledJSON("map", "assets/map_glitter.json");
    this.load.image("tileset1", "assets/tileset.png");

    // Load the player spritesheet
    // Assumes a 32x48 sprite with 12 frames: 3 per direction (down, left, right, up)
    this.load.spritesheet("player", "assets/entities/character_01_small.png", {
      frameWidth: 32,
      frameHeight: 28,
    });
  }

  create() {
    this.createMap();
    this.createPlayer();
    this.createAnimations();
    this.createCamera();
    this.createStandInteractions();
    this.createUI();
    this.setupInput();
  }

  private createMap() {
    this.map = this.make.tilemap({ key: "map" });

    // "tileset1" = key from preload, "tileset1" = name inside the .tsx file
    const tileset = this.map.addTilesetImage("tileset1", "tileset1");
    if (!tileset) throw new Error("Failed to load tileset");
    this.tileset = tileset;

    // Create tile layers — names must match exactly what's in your .tmj
    this.floorLayer = this.map.createLayer("Floor", this.tileset, 0, 0)!;

    // Your booth/wall tile layer
    this.structuresLayer = this.map.createLayer(
      "Structures",
      this.tileset,
      0,
      0,
    )!;

    // Enable collisions using the "collides" property you set in the tileset
    this.structuresLayer.setCollisionByProperty({ collides: true });

    // Get the object layer (not a tile layer — this is your stand zones)
    const standsLayer = this.map.getObjectLayer("Stands");
    if (!standsLayer) throw new Error("Stands object layer not found");
    this.standsLayer = standsLayer;
  }

  private createPlayer() {
    // Find the spawn point defined in Tiled (add a point object named "spawn" in your map)
    const spawnPoint = this.map.findObject(
      "Stands",
      (obj) => obj.name === "spawn",
    );

    const spawnX = spawnPoint?.x ?? 640; // fallback to map center
    const spawnY = spawnPoint?.y ?? 480;

    this.player = this.physics.add
      .sprite(spawnX, spawnY, "player", 0)
      .setOrigin(0, 1)
      .setScale(2);
    this.player.setCollideWorldBounds(true);

    // Player hitbox — make it smaller than the sprite for better feel
    // A 32x48 sprite with a 20x16 hitbox at the feet
    this.player.body?.setSize(20, 16);
    this.player.body?.setOffset(6, 28); // offset pushes hitbox to the bottom of the sprite
  }

  private createAnimations() {
    // Walk down — frames 0, 1, 2
    this.anims.create({
      key: "walk-down",
      frames: this.anims.generateFrameNumbers("player", { start: 0, end: 2 }),
      frameRate: 8,
      repeat: -1,
    });

    // Walk left — frames 3, 4, 5
    this.anims.create({
      key: "walk-left",
      frames: this.anims.generateFrameNumbers("player", { start: 3, end: 5 }),
      frameRate: 8,
      repeat: -1,
    });

    // Walk right — frames 6, 7, 8
    this.anims.create({
      key: "walk-right",
      frames: this.anims.generateFrameNumbers("player", { start: 6, end: 8 }),
      frameRate: 8,
      repeat: -1,
    });

    // Walk up — frames 9, 10, 11
    this.anims.create({
      key: "walk-up",
      frames: this.anims.generateFrameNumbers("player", { start: 9, end: 11 }),
      frameRate: 8,
      repeat: -1,
    });

    // Idle — just frame 0 (facing down, standing still)
    this.anims.create({
      key: "idle",
      frames: [{ key: "player", frame: 0 }],
      frameRate: 1,
    });
  }

  // ─── CAMERA ──────────────────────────────────────────────────────────────

  private createCamera() {
    // Set world bounds to match the full map size (40 * 32 = 1280, 30 * 32 = 960)
    this.physics.world.setBounds(
      0,
      0,
      this.map.widthInPixels,
      this.map.heightInPixels,
    );

    this.cameras.main.setBounds(
      0,
      0,
      this.map.widthInPixels,
      this.map.heightInPixels,
    );
    this.cameras.main.startFollow(this.player, true, 0.1, 0.1); // 0.1 = smooth follow
    this.cameras.main.setZoom(1.5); // zoom in for mobile readability
  }

  // ─── STAND INTERACTIONS ──────────────────────────────────────────────────

  private createStandInteractions() {
    // Add collider between player and the structure tiles
    this.physics.add.collider(this.player, this.structuresLayer);

    // For each stand zone object, create an invisible physics zone
    this.standsLayer.objects.forEach((standObj) => {
      if (!standObj.name || standObj.name === "spawn") return;

      const zone = this.add.zone(
        standObj.x! + standObj.width! / 2, // Phaser zones are centered
        standObj.y! + standObj.height! / 2,
        standObj.width!,
        standObj.height!,
      );

      this.physics.world.enable(zone);
      (zone.body as Phaser.Physics.Arcade.Body).setAllowGravity(false);
      (zone.body as Phaser.Physics.Arcade.Body).moves = false;

      // When player overlaps a stand zone, trigger the interaction
      this.physics.add.overlap(this.player, zone, () => {
        if (!this.isPopupOpen && this.activeStand !== standObj.name) {
          this.activeStand = standObj.name!;
          this.openStandPopup(standObj.name!);
        }
      });
    });
  }

  private async openStandPopup(standId: string) {
    this.isPopupOpen = true;
    this.touchActive = false;
    this.touchDeltaX = 0;
    this.touchDeltaY = 0;
    this.player.setVelocity(0, 0); // stop the player

    // Check cache first
    if (this.standDataCache.has(standId)) {
      this.showPopup(this.standDataCache.get(standId)!);
      return;
    }

    // Fetch from your API — replace with your actual Next.js API route
    try {
      // const res = await fetch(`/api/stands/${standId}`)ß;
      // const data: StandData = await res.json();
      // this.standDataCache.set(standId, data); // cache it
      const data: StandData = {
        id: standId,
        participant_name: `Participant name in ${standId}`,
        description: `Description in ${standId}`,
        category: `Category in ${standId}`,
        instagram: `Instagram in ${standId}`,
        photo_url: `Photo url in ${standId}`,
      };
      this.showPopup(data);
    } catch (err) {
      console.error("Failed to fetch stand data:", err);
      this.isPopupOpen = false;
      this.activeStand = null;
    }
  }

  // ─── UI ──────────────────────────────────────────────────────────────────

  private createUI() {
    // Container is fixed to camera — always visible regardless of map scroll
    this.standPopup = this.add
      .container(0, 0)
      .setScrollFactor(0)
      .setVisible(false);
  }

  private showPopup(data: StandData) {
    const { width, height } = this.scale;

    // Clear any previous content
    this.standPopup.removeAll(true);

    // Background panel
    const bg = this.add
      .rectangle(width / 2, height - 120, width - 32, 200, 0x1a1a2e, 0.95)
      .setStrokeStyle(2, 0xf5a623);

    // Stand name
    const nameText = this.add
      .text(width / 2, height - 195, data.participant_name, {
        fontSize: "18px",
        color: "#f5a623",
        fontStyle: "bold",
      })
      .setOrigin(0.5);

    // Category
    const categoryText = this.add
      .text(width / 2, height - 172, data.category, {
        fontSize: "12px",
        color: "#aaaaaa",
      })
      .setOrigin(0.5);

    // Description
    const descText = this.add
      .text(width / 2, height - 150, data.description, {
        fontSize: "13px",
        color: "#ffffff",
        wordWrap: { width: width - 64 },
        align: "center",
      })
      .setOrigin(0.5);

    // Instagram
    const igText = data.instagram
      ? this.add
          .text(width / 2, height - 60, `@${data.instagram}`, {
            fontSize: "12px",
            color: "#c084fc",
          })
          .setOrigin(0.5)
      : null;

    // Close button
    const closeBtn = this.add
      .text(width - 32, height - 210, "✕", {
        fontSize: "18px",
        color: "#ffffff",
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on("pointerdown", () => this.closePopup());

    this.standPopup.add([bg, nameText, categoryText, descText, closeBtn]);
    if (igText) this.standPopup.add(igText);

    this.standPopup.setVisible(true);
  }

  private closePopup() {
    this.standPopup.setVisible(false);
    this.isPopupOpen = false;
    this.activeStand = null;
  }

  // ─── INPUT ───────────────────────────────────────────────────────────────

  private setupInput() {
    // Arrow keys
    this.cursors = this.input.keyboard!.createCursorKeys();

    // WASD
    this.wasd = {
      up: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      down: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      left: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      right: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    };

    // Close popup with Escape
    this.input.keyboard!.on("keydown-ESC", () => {
      if (this.isPopupOpen) this.closePopup();
    });

    // Touch / drag-to-move
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (this.isPopupOpen) return;
      this.touchActive = true;
      this.touchStartX = pointer.x;
      this.touchStartY = pointer.y;
      this.touchDeltaX = 0;
      this.touchDeltaY = 0;
    });

    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      if (!this.touchActive || !pointer.isDown) return;
      this.touchDeltaX = pointer.x - this.touchStartX;
      this.touchDeltaY = pointer.y - this.touchStartY;
    });

    this.input.on("pointerup", () => {
      this.touchActive = false;
      this.touchDeltaX = 0;
      this.touchDeltaY = 0;
    });
  }

  // ─── UPDATE ──────────────────────────────────────────────────────────────

  update() {
    if (this.isPopupOpen) {
      this.player.setVelocity(0, 0);
      this.player.anims.play("idle", true);
      return;
    }

    this.handleMovement();
  }

  private handleMovement() {
    const touchUp    = this.touchActive && this.touchDeltaY < -this.TOUCH_DEADZONE;
    const touchDown  = this.touchActive && this.touchDeltaY >  this.TOUCH_DEADZONE;
    const touchLeft  = this.touchActive && this.touchDeltaX < -this.TOUCH_DEADZONE;
    const touchRight = this.touchActive && this.touchDeltaX >  this.TOUCH_DEADZONE;

    const up    = this.cursors.up.isDown    || this.wasd.up.isDown    || touchUp;
    const down  = this.cursors.down.isDown  || this.wasd.down.isDown  || touchDown;
    const left  = this.cursors.left.isDown  || this.wasd.left.isDown  || touchLeft;
    const right = this.cursors.right.isDown || this.wasd.right.isDown || touchRight;

    // Reset velocity each frame
    this.player.setVelocity(0, 0);

    if (left) {
      this.player.setVelocityX(-this.PLAYER_SPEED);
      this.player.anims.play("walk-left", true);
    } else if (right) {
      this.player.setVelocityX(this.PLAYER_SPEED);
      this.player.anims.play("walk-right", true);
    } else if (up) {
      this.player.setVelocityY(-this.PLAYER_SPEED);
      this.player.anims.play("walk-up", true);
    } else if (down) {
      this.player.setVelocityY(this.PLAYER_SPEED);
      this.player.anims.play("walk-down", true);
    } else {
      this.player.anims.play("idle", true);
    }

    // Normalize diagonal movement
    this.player.body?.velocity.normalize().scale(this.PLAYER_SPEED);
  }
}
