import { Scene } from "phaser";
import { type FestivalStand } from "../../types/stands";
import { uiTheme } from "../theme";

function standCacheKey(stand: FestivalStand): string {
  return `stand_${(stand.standLabel ?? "").toLowerCase()}${stand.standNumber}`;
}

export class Game extends Scene {
  private map!: Phaser.Tilemaps.Tilemap;
  private tilesets!: Phaser.Tilemaps.Tileset[];
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
  private touchDeadzone = 12; // computed from screen size in create()
  private touchDecay = 0; // 1.0 → 0 over several frames after finger lift
  private readonly TOUCH_DECAY_RATE = 0.12;
  private lastMoveByTouch = false;
  private dragIndicator: Phaser.GameObjects.Arc | null = null;
  private uiCamera!: Phaser.Cameras.Scene2D.Camera;

  // Stands
  private standsLayer!: Phaser.Tilemaps.ObjectLayer;
  private activeStand: string | null = null;
  private standDataCache: Map<string, FestivalStand> = new Map();
  private standLabels: Map<
    string,
    {
      container: Phaser.GameObjects.Container;
      bg: Phaser.GameObjects.Rectangle;
      nameText: Phaser.GameObjects.Text;
    }
  > = new Map();

  // UI
  private standPopup!: Phaser.GameObjects.Container;
  private backBtnBg!: Phaser.GameObjects.Rectangle;
  private backBtnLabel!: Phaser.GameObjects.Text;
  private interactPrompt!: Phaser.GameObjects.Container;
  private interactPromptBg!: Phaser.GameObjects.Rectangle;
  private interactPromptText!: Phaser.GameObjects.Text;
  private interactKey!: Phaser.Input.Keyboard.Key;
  private isPopupOpen = false;
  private closeBtnBounds = { x: 0, y: 0, halfSize: 22 };
  private popupBounds = { top: 0, bottom: 0, left: 0, right: 0 };

  // Zone-exit tracking (prevents popup from reopening while player stays in zone)
  private currentOverlaps = new Set<string>();
  private previousOverlaps = new Set<string>();
  private zoneExitFrames = 0;
  private readonly ZONE_EXIT_DELAY = 5;

  // Constants
  private readonly PLAYER_SPEED = 160;

  constructor() {
    super("Game");
  }

  preload() {
    // ── Loading screen ────────────────────────────────────────────────────────
    const { width, height } = this.scale;

    const loadingBg = this.add
      .rectangle(0, 0, width, height, uiTheme.colors.bgCanvas)
      .setOrigin(0);

    const loadingText = this.add
      .text(width / 2, height / 2, "Cargando…", {
        fontSize: "22px",
        color: uiTheme.text.accent,
        fontStyle: "bold",
      })
      .setOrigin(0.5);

    this.tweens.add({
      targets: loadingText,
      alpha: 0.3,
      duration: 700,
      yoyo: true,
      repeat: -1,
    });

    this.load.once("complete", () => {
      loadingBg.destroy();
      loadingText.destroy();
    });

    // ── Assets ────────────────────────────────────────────────────────────────
    this.load.tilemapTiledJSON("map", "assets/map_glitter.json");
    this.load.image("tileset1", "assets/tileset.png");
    this.load.image("mesas", "assets/mesas.png");

    // Load the player spritesheet for the selected character
    // Assumes a 32x52 sprite with 12 frames: 3 per direction (down, left, right, up)
    const char =
      (this.scene.settings.data as { character?: string })?.character ??
      "federico";
    if (this.textures.exists("player")) {
      this.textures.remove("player");
    }
    this.load.spritesheet("player", `assets/entities/${char}.png`, {
      frameWidth: 32,
      frameHeight: 52,
    });

    const festivalId =
      (
        this.scene.settings.data as { festivalId?: number }
      )?.festivalId?.toString() ??
      new URLSearchParams(window.location.search).get("festivalId") ??
      import.meta.env.VITE_FESTIVAL_ID;
    if (festivalId) {
      this.load.json(
        "festivalStands",
        `${import.meta.env.VITE_API_BASE_URL}/festivals/${festivalId}/stands`,
      );
    }
  }

  create() {
    this.createMap();
    const standsResponse = this.cache.json.get("festivalStands") as
      | { stands: FestivalStand[]; error?: string }
      | undefined;
    if (standsResponse?.error) {
      console.warn("Failed to load stands:", standsResponse.error);
    }
    if (standsResponse?.stands) {
      for (const stand of standsResponse.stands) {
        this.standDataCache.set(standCacheKey(stand), stand);
      }
    }
    this.createPlayer();
    this.createAnimations();
    this.createCamera();
    this.createStandInteractions();
    this.createUI();
    this.touchDeadzone = Math.min(this.scale.width, this.scale.height) * 0.025;
    this.setupInput();

    // Main camera (zoomed) ignores UI; UI camera (1x) ignores the game world
    this.cameras.main.ignore([
      this.standPopup,
      this.backBtnBg,
      this.backBtnLabel,
      this.dragIndicator!,
      this.interactPrompt,
    ]);
    this.uiCamera.ignore([
      this.floorLayer,
      this.structuresLayer,
      this.player,
      ...[...this.standLabels.values()].map((l) => l.container),
    ]);
  }

  private createMap() {
    this.map = this.make.tilemap({ key: "map" });

    const tileset1 = this.map.addTilesetImage("tileset1", "tileset1");
    if (!tileset1) throw new Error("Failed to load tileset1");

    const mesas = this.map.addTilesetImage("booth_test", "mesas");
    if (!mesas) throw new Error("Failed to load mesas tileset");

    this.tilesets = [tileset1, mesas];

    this.floorLayer = this.map.createLayer("Floor", this.tilesets, 0, 0)!;

    this.structuresLayer = this.map.createLayer(
      "Structures",
      this.tilesets,
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
      .setDepth(2);
    this.player.setCollideWorldBounds(true);

    // Player hitbox — make it smaller than the sprite for better feel
    // A 32x48 sprite with a 20x16 hitbox at the feet
    this.player.body?.setSize(20, 16);
    this.player.body?.setOffset(6, 28); // offset pushes hitbox to the bottom of the sprite
  }

  private createAnimations() {
    // Remove stale animations from a previous scene run (texture may have changed)
    ["walk-down", "walk-left", "walk-right", "walk-up", "idle"].forEach(
      (key) => {
        if (this.anims.exists(key)) this.anims.remove(key);
      },
    );

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
    this.cameras.main.setZoom(1.5);
    this.cameras.main.startFollow(this.player, true, 0.1, 0.1);

    this.uiCamera = this.cameras.add(0, 0, this.scale.width, this.scale.height);
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

      // When player overlaps a stand zone, show interact prompt
      this.physics.add.overlap(this.player, zone, () => {
        if (standObj.name) this.currentOverlaps.add(standObj.name);
        if (!this.isPopupOpen && this.activeStand !== standObj.name) {
          if (this.activeStand) this.hideInteractPrompt(); // restore previous label
          this.activeStand = standObj.name!;
          const data = this.standDataCache.get(standObj.name!);
          if (data) this.showInteractPrompt();
        }
      });

      // Floating label above the zone (only for stands with cached data)
      const standData = this.standDataCache.get(standObj.name!);
      if (standData) {
        const lbl = this.createStandLabel(standObj, standData.standDisplayLabel);
        this.standLabels.set(standObj.name!, lbl);
      }
    });
  }

  private createStandLabel(
    standObj: Phaser.Types.Tilemaps.TiledObject,
    displayLabel: string,
  ): {
    container: Phaser.GameObjects.Container;
    bg: Phaser.GameObjects.Rectangle;
    nameText: Phaser.GameObjects.Text;
  } {
    const x = standObj.x! + standObj.width! / 2;
    const y = standObj.y! - 18;

    const label =
      displayLabel.length > 18 ? displayLabel.slice(0, 18) + "…" : displayLabel;

    const text = this.add
      .text(0, 0, label, {
        fontSize: "10px",
        color: uiTheme.text.accent,
        fontStyle: "bold",
      })
      .setOrigin(0.5);

    const padX = 8;
    const padY = 5;
    const bg = this.add
      .rectangle(
        0,
        0,
        text.width + padX * 2,
        text.height + padY * 2,
        uiTheme.colors.surface,
        1,
      )
      .setStrokeStyle(1.5, uiTheme.colors.borderStrong);

    const container = this.add.container(x, y, [bg, text]).setDepth(3);

    this.tweens.add({
      targets: container,
      y: y - 4,
      duration: 900,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });

    return { container, bg, nameText: text };
  }

  private openStandPopup(standId: string) {
    this.isPopupOpen = true;
    this.touchActive = false;
    this.touchDecay = 0;
    this.touchDeltaX = 0;
    this.touchDeltaY = 0;
    this.dragIndicator?.setVisible(false);
    this.player.setVelocity(0, 0);

    const data = this.standDataCache.get(standId);
    if (data) {
      this.backBtnBg.setVisible(false);
      this.backBtnLabel.setVisible(false);
      this.showPopup(data);
    } else {
      // No API data for this stand — reset state silently
      this.isPopupOpen = false;
      this.activeStand = null;
    }
  }

  private showInteractPrompt() {
    this.interactPrompt.setVisible(true);
    const lbl = this.activeStand ? this.standLabels.get(this.activeStand) : null;
    if (lbl) {
      lbl.bg.setFillStyle(uiTheme.colors.accentPrimary, 1);
      lbl.bg.setStrokeStyle(0);
      lbl.nameText.setColor("#ffffff");
    }
  }

  private hideInteractPrompt() {
    this.interactPrompt.setVisible(false);
    if (this.activeStand) {
      const lbl = this.standLabels.get(this.activeStand);
      if (lbl) {
        lbl.bg.setFillStyle(uiTheme.colors.surface, 1);
        lbl.bg.setStrokeStyle(1.5, uiTheme.colors.borderStrong);
        lbl.nameText.setColor(uiTheme.text.accent);
      }
    }
  }

  private triggerStandInteraction() {
    if (!this.activeStand || this.isPopupOpen) return;
    this.hideInteractPrompt();
    this.openStandPopup(this.activeStand);
  }

  // ─── UI ──────────────────────────────────────────────────────────────────

  private createUI() {
    // Container is fixed to camera — always visible regardless of map scroll
    this.standPopup = this.add
      .container(0, 0)
      .setScrollFactor(0)
      .setVisible(false);

    // Back button — top-left corner, standalone objects on the scene display list
    // (not inside a Container) so Phaser's input system can hit-test them.
    this.backBtnBg = this.add
      .rectangle(12, 12, 120, 40, uiTheme.colors.surface, uiTheme.alpha.surface)
      .setStrokeStyle(2, uiTheme.colors.borderStrong)
      .setOrigin(0)
      .setScrollFactor(0)
      .setDepth(20)
      .setInteractive();
    this.backBtnLabel = this.add
      .text(20, 32, "< Personajes", {
        fontSize: "14px",
        color: uiTheme.text.accent,
      })
      .setOrigin(0, 0.5)
      .setScrollFactor(0)
      .setDepth(21);
    this.backBtnBg.on("pointerdown", () => this.scene.start("CharacterSelect"));
    this.backBtnBg.on("pointerover", () =>
      this.backBtnBg.setFillStyle(uiTheme.colors.accentSoft, 1),
    );
    this.backBtnBg.on("pointerout", () =>
      this.backBtnBg.setFillStyle(
        uiTheme.colors.surface,
        uiTheme.alpha.surface,
      ),
    );

    // Drag indicator - follows pointer position while dragging
    this.dragIndicator = this.add
      .circle(0, 0, 24, uiTheme.colors.accentPrimary, 0.12)
      .setScrollFactor(0)
      .setDepth(10)
      .setVisible(false);
    this.dragIndicator.setStrokeStyle(2, uiTheme.colors.borderStrong, 0.55);

    // Interact prompt — appears when player enters a stand zone
    const promptY = this.scale.height - 72;
    const padX = 24;
    const padY = 14;
    this.interactPromptText = this.add
      .text(this.scale.width / 2, promptY, "Presiona para ver el stand", {
        fontSize: "13px",
        color: "#ffffff",
        fontStyle: "bold",
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(21);
    this.interactPromptBg = this.add
      .rectangle(
        this.scale.width / 2,
        promptY,
        this.interactPromptText.width + padX * 2,
        this.interactPromptText.height + padY * 2,
        uiTheme.colors.accentPrimary,
        1,
      )
      .setScrollFactor(0)
      .setDepth(20)
      .setInteractive();
    this.interactPrompt = this.add
      .container(0, 0, [this.interactPromptBg, this.interactPromptText])
      .setScrollFactor(0)
      .setVisible(false);
    this.interactPromptBg.on("pointerdown", () =>
      this.triggerStandInteraction(),
    );
    this.interactPromptBg.on("pointerover", () =>
      this.interactPromptBg.setFillStyle(uiTheme.colors.accentHover, 1),
    );
    this.interactPromptBg.on("pointerout", () =>
      this.interactPromptBg.setFillStyle(uiTheme.colors.accentPrimary, 1),
    );
  }

  private showPopup(data: FestivalStand) {
    const { width, height } = this.scale;
    this.standPopup.removeAll(true);

    const popupWidth = Math.min(width - 32, 480);
    const centerX = width / 2;
    const padding = 16;
    const bottomMargin = 16;
    const baseFontSize = Math.min(
      14,
      Math.max(11, Math.round(Math.min(width, height) * 0.038)),
    );

    // ── Build content items at relY=0; shifted to final Y after measuring ──────
    const contentItems: Phaser.GameObjects.GameObject[] = [];
    let relY = 0;

    // Stand title
    const titleText = this.add
      .text(centerX, relY, data.standDisplayLabel, {
        fontSize: `${Math.round(baseFontSize * 1.3)}px`,
        color: uiTheme.text.accent,
        fontStyle: "bold",
        align: "center",
        wordWrap: { width: popupWidth - padding * 2 },
      })
      .setOrigin(0.5, 0);
    relY += titleText.height + 14;
    contentItems.push(titleText);

    // Each participant
    data.participants.forEach((participant, index) => {
      // Divider between participants
      if (index > 0) {
        const divider = this.add.rectangle(
          centerX,
          relY + 6,
          popupWidth - padding * 4,
          1,
          uiTheme.colors.border,
          0.9,
        );
        relY += 14;
        contentItems.push(divider);
      }

      // Avatar circle + initial
      const avatarRadius = Math.round(baseFontSize * 1.5);
      const avatarRelCenterY = relY + avatarRadius;
      const initial = (participant.displayName ?? "?").charAt(0).toUpperCase();
      const avatar = this.add.circle(
        centerX,
        avatarRelCenterY,
        avatarRadius,
        uiTheme.colors.surfaceMuted,
        uiTheme.alpha.avatar,
      );
      avatar.setStrokeStyle(2, uiTheme.colors.borderStrong, 0.9);
      const avatarInitial = this.add
        .text(centerX, avatarRelCenterY, initial, {
          fontSize: `${Math.round(baseFontSize * 1.2)}px`,
          color: uiTheme.text.accent,
          fontStyle: "bold",
        })
        .setOrigin(0.5);
      relY += avatarRadius * 2 + 10;
      contentItems.push(avatar, avatarInitial);

      if (participant.displayName) {
        const nameText = this.add
          .text(centerX, relY, participant.displayName, {
            fontSize: `${Math.round(baseFontSize * 1.1)}px`,
            color: uiTheme.text.primary,
            fontStyle: "bold",
            align: "center",
            wordWrap: { width: popupWidth - padding * 2 },
          })
          .setOrigin(0.5, 0);
        relY += nameText.height + 4;
        contentItems.push(nameText);
      }

      if (participant.category) {
        const categoryText = this.add
          .text(centerX, relY, participant.category, {
            fontSize: `${baseFontSize}px`,
            color: uiTheme.text.secondary,
            align: "center",
          })
          .setOrigin(0.5, 0);
        relY += categoryText.height + 6;
        contentItems.push(categoryText);
      }

      for (const social of participant.socials) {
        const color =
          social.type.toLowerCase() === "instagram"
            ? uiTheme.text.instagram
            : uiTheme.text.accent;
        const socialText = this.add
          .text(centerX, relY, `@${social.username}`, {
            fontSize: `${baseFontSize}px`,
            color,
            align: "center",
          })
          .setOrigin(0.5, 0);
        relY += socialText.height + 4;
        contentItems.push(socialText);
      }

      relY += 6;
    });

    // ── Compute popup geometry ──────────────────────────────────────────────────
    const closeRowHeight = 44;
    const popupHeight = padding + closeRowHeight + padding + relY + padding;
    const popupTop = Math.max(
      bottomMargin,
      height - popupHeight - bottomMargin,
    );
    const popupCenterY = popupTop + popupHeight / 2;
    const contentStartY = popupTop + padding + closeRowHeight + padding;

    // Shift all content items to final Y positions
    for (const item of contentItems) {
      if (
        item instanceof Phaser.GameObjects.Text ||
        item instanceof Phaser.GameObjects.Arc ||
        item instanceof Phaser.GameObjects.Rectangle
      ) {
        item.setY(item.y + contentStartY);
      }
    }

    // ── Save bounds for scene-level click handling ─────────────────────────────
    const closeBtnX = centerX + popupWidth / 2 - padding - 10;
    const closeBtnY = popupTop + padding + closeRowHeight / 2;
    this.closeBtnBounds = { x: closeBtnX, y: closeBtnY, halfSize: 22 };
    this.popupBounds = {
      top: popupTop,
      bottom: popupTop + popupHeight,
      left: centerX - popupWidth / 2,
      right: centerX + popupWidth / 2,
    };

    // ── Dim overlay ────────────────────────────────────────────────────────────
    const overlay = this.add.rectangle(
      width / 2,
      height / 2,
      width,
      height,
      uiTheme.colors.overlay,
      uiTheme.alpha.overlay,
    );

    // ── Background panel ───────────────────────────────────────────────────────
    const bg = this.add
      .rectangle(
        centerX,
        popupCenterY,
        popupWidth,
        popupHeight,
        uiTheme.colors.surface,
        uiTheme.alpha.surfaceStrong,
      )
      .setStrokeStyle(2, uiTheme.colors.borderStrong);

    // ── Close button ───────────────────────────────────────────────────────────
    const closeBg = this.add.rectangle(
      closeBtnX,
      closeBtnY,
      44,
      44,
      uiTheme.colors.surface,
      uiTheme.alpha.surface,
    );
    closeBg.setStrokeStyle(2, uiTheme.colors.borderStrong);
    const closeIcon = this.add
      .text(closeBtnX, closeBtnY, "✕", {
        fontSize: `${Math.round(baseFontSize * 1.1)}px`,
        color: uiTheme.text.accent,
      })
      .setOrigin(0.5);

    this.standPopup.add([overlay, bg, ...contentItems, closeBg, closeIcon]);
    this.standPopup.setVisible(true);
  }

  private closePopup() {
    this.standPopup.setVisible(false);
    this.isPopupOpen = false;
    this.backBtnBg.setVisible(true);
    this.backBtnLabel.setVisible(true);
    // activeStand intentionally NOT reset here — zone-exit detection in update() handles it,
    // preventing the overlap callback from reopening the popup while player stays in the zone
    this.touchActive = false;
    this.touchDecay = 0;
    this.touchDeltaX = 0;
    this.touchDeltaY = 0;
    this.dragIndicator?.setVisible(false);
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

    // Interact key (E) — opens stand popup when in a zone
    this.interactKey = this.input.keyboard!.addKey(
      Phaser.Input.Keyboard.KeyCodes.E,
    );

    // On first keyboard input, reveal the E key hint and resize the button to fit
    this.input.keyboard!.once("keydown", () => {
      this.interactPromptText.setText("Presiona para ver el stand  ·  E");
      this.interactPromptBg.setSize(
        this.interactPromptText.width + 24 * 2,
        this.interactPromptBg.height,
      );
    });

    // Touch / drag-to-move
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (this.isPopupOpen) {
        const onClose =
          Math.abs(pointer.x - this.closeBtnBounds.x) <=
            this.closeBtnBounds.halfSize &&
          Math.abs(pointer.y - this.closeBtnBounds.y) <=
            this.closeBtnBounds.halfSize;
        const outside =
          pointer.x < this.popupBounds.left ||
          pointer.x > this.popupBounds.right ||
          pointer.y < this.popupBounds.top ||
          pointer.y > this.popupBounds.bottom;
        if (onClose || outside) this.closePopup();
        return;
      }
      this.touchActive = true;
      this.touchDecay = 0;
      this.lastMoveByTouch = true;
      this.touchStartX = pointer.x;
      this.touchStartY = pointer.y;
      this.touchDeltaX = 0;
      this.touchDeltaY = 0;
      this.dragIndicator?.setPosition(pointer.x, pointer.y).setVisible(true);
    });

    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      if (!this.touchActive) return;
      this.touchDeltaX = pointer.x - this.touchStartX;
      this.touchDeltaY = pointer.y - this.touchStartY;
      this.dragIndicator?.setPosition(pointer.x, pointer.y);
    });

    this.input.on("pointerup", () => {
      // A tap (no significant drag) while in a stand zone triggers the interaction
      const isTap =
        Math.abs(this.touchDeltaX) <= this.touchDeadzone &&
        Math.abs(this.touchDeltaY) <= this.touchDeadzone;
      if (isTap && !this.isPopupOpen) this.triggerStandInteraction();

      this.touchActive = false;
      this.touchDecay = 1.0; // begin deceleration — deltas preserved briefly
      this.dragIndicator?.setVisible(false);
    });

    this.input.on("pointerout", () => {
      this.touchActive = false;
      this.touchDecay = 0;
      this.touchDeltaX = 0;
      this.touchDeltaY = 0;
      this.dragIndicator?.setVisible(false);
    });
  }

  // ─── UPDATE ──────────────────────────────────────────────────────────────

  update() {
    // Reset activeStand only when player physically leaves a zone (not on popup close).
    // Grace counter debounces physics edge noise — zone must be absent for N frames.
    if (this.activeStand && !this.currentOverlaps.has(this.activeStand)) {
      this.zoneExitFrames++;
      if (this.zoneExitFrames >= this.ZONE_EXIT_DELAY) {
        this.hideInteractPrompt(); // restore label before clearing activeStand
        this.activeStand = null;
        this.zoneExitFrames = 0;
      }
    } else {
      this.zoneExitFrames = 0;
    }
    this.previousOverlaps = new Set(this.currentOverlaps);
    this.currentOverlaps.clear();

    if (this.isPopupOpen) {
      this.player.setVelocity(0, 0);
      this.player.anims.play("idle", true);
      return;
    }

    // E key triggers stand interaction
    if (Phaser.Input.Keyboard.JustDown(this.interactKey)) {
      this.triggerStandInteraction();
    }

    this.handleMovement();
  }

  private handleMovement() {
    // Decay touch velocity each frame after finger lift
    if (!this.touchActive && this.touchDecay > 0) {
      this.touchDecay = Math.max(0, this.touchDecay - this.TOUCH_DECAY_RATE);
      if (this.touchDecay === 0) {
        this.touchDeltaX = 0;
        this.touchDeltaY = 0;
      }
    }

    const touchActive = this.touchActive || this.touchDecay > 0;
    const touchUp = touchActive && this.touchDeltaY < -this.touchDeadzone;
    const touchDown = touchActive && this.touchDeltaY > this.touchDeadzone;
    const touchLeft = touchActive && this.touchDeltaX < -this.touchDeadzone;
    const touchRight = touchActive && this.touchDeltaX > this.touchDeadzone;

    const keyUp = this.cursors.up.isDown || this.wasd.up.isDown;
    const keyDown = this.cursors.down.isDown || this.wasd.down.isDown;
    const keyLeft = this.cursors.left.isDown || this.wasd.left.isDown;
    const keyRight = this.cursors.right.isDown || this.wasd.right.isDown;

    if (keyUp || keyDown || keyLeft || keyRight) this.lastMoveByTouch = false;

    const up = keyUp || touchUp;
    const down = keyDown || touchDown;
    const left = keyLeft || touchLeft;
    const right = keyRight || touchRight;

    this.player.setVelocity(0, 0);

    if (left) this.player.setVelocityX(-this.PLAYER_SPEED);
    if (right) this.player.setVelocityX(this.PLAYER_SPEED);
    if (up) this.player.setVelocityY(-this.PLAYER_SPEED);
    if (down) this.player.setVelocityY(this.PLAYER_SPEED);

    // Decay only applies when the movement was touch-initiated
    const speed =
      this.PLAYER_SPEED *
      (this.touchActive ? 1 : this.lastMoveByTouch ? this.touchDecay || 1 : 1);
    this.player.body?.velocity.normalize().scale(speed);

    // Animations — prioritize horizontal for diagonals
    if (left) this.player.anims.play("walk-left", true);
    else if (right) this.player.anims.play("walk-right", true);
    else if (up) this.player.anims.play("walk-up", true);
    else if (down) this.player.anims.play("walk-down", true);
    else this.player.anims.play("idle", true);
  }
}
