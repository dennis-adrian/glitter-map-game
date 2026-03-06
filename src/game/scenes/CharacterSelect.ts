import { Scene } from "phaser";

const CHARACTERS = [
  { key: "federico", label: "Federico" },
  { key: "theo", label: "Theo" },
];

const CARD_W = 120;
const CARD_H = 160;
const CARD_GAP = 32;
const SPRITE_SCALE = 2;
const FRAME_W = 32;
const FRAME_H = 52;
const COLOR_BG = 0x1a1a2e;
const COLOR_SELECTED = 0xf5a623;
const COLOR_UNSELECTED = 0x333344;
const COLOR_GOLD_TEXT = "#f5a623";

export class CharacterSelect extends Scene {
  private selectedIndex = 0;
  private cards: Phaser.GameObjects.Container[] = [];
  private container!: Phaser.GameObjects.Container;
  private playBtn!: Phaser.GameObjects.Container;
  private festivalId!: number;

  constructor() {
    super("CharacterSelect");
  }

  preload() {
    for (const { key } of CHARACTERS) {
      this.load.spritesheet(key, `assets/entities/${key}.png`, {
        frameWidth: FRAME_W,
        frameHeight: FRAME_H,
      });
    }
  }

  create() {
    this.festivalId =
      (this.scene.settings.data as { festivalId?: number })?.festivalId ??
      Number(
        new URLSearchParams(window.location.search).get("festivalId") ??
          import.meta.env.VITE_FESTIVAL_ID,
      );

    this.buildAnimations();
    this.buildUI();

    // Keyboard navigation
    const keys = this.input.keyboard!;
    keys.on("keydown-LEFT", () => this.selectIndex(0));
    keys.on("keydown-RIGHT", () => this.selectIndex(1));
    keys.on("keydown-ENTER", () => this.startGame());
    keys.on("keydown-SPACE", () => this.startGame());

    this.scale.on("resize", () => this.repositionUI());
  }

  private buildAnimations() {
    for (const { key } of CHARACTERS) {
      if (!this.anims.exists(`${key}-walk-down`)) {
        this.anims.create({
          key: `${key}-walk-down`,
          frames: this.anims.generateFrameNumbers(key, { start: 0, end: 2 }),
          frameRate: 8,
          repeat: -1,
        });
      }
    }
  }

  private buildUI() {
    const { width, height } = this.scale;

    this.add.rectangle(0, 0, width, height, COLOR_BG).setOrigin(0);

    // Back button — top-left, matching Game scene style
    const backBg = this.add
      .rectangle(12, 12, 130, 40, 0x000000, 0.75)
      .setStrokeStyle(2, 0xf5a623)
      .setOrigin(0)
      .setInteractive();
    this.add
      .text(20, 32, "< Festivales", { fontSize: "14px", color: "#f5a623" })
      .setOrigin(0, 0.5);
    backBg.on("pointerdown", () => this.scene.start("FestivalSelect"));
    backBg.on("pointerover", () => backBg.setFillStyle(0x000000, 1));
    backBg.on("pointerout", () => backBg.setFillStyle(0x000000, 0.75));

    this.container = this.add.container(width / 2, height / 2);

    // Title
    const title = this.add
      .text(0, -CARD_H / 2 - 60, "Elije tu personaje", {
        fontSize: "22px",
        color: COLOR_GOLD_TEXT,
        fontStyle: "bold",
      })
      .setOrigin(0.5);

    this.container.add(title);

    // Cards
    this.cards = CHARACTERS.map(({ key, label }, i) => {
      const card = this.buildCard(key, label, i);
      this.container.add(card);
      return card;
    });

    this.positionCards();

    // Play button
    this.playBtn = this.buildPlayButton();
    this.playBtn.setPosition(0, CARD_H / 2 + 48);
    this.container.add(this.playBtn);

    this.refreshSelection();
  }

  private buildCard(
    key: string,
    label: string,
    index: number,
  ): Phaser.GameObjects.Container {
    const card = this.add.container(0, 0);

    const bg = this.add
      .rectangle(0, 0, CARD_W, CARD_H, COLOR_UNSELECTED, 0.7)
      .setStrokeStyle(3, COLOR_UNSELECTED);

    const sprite = this.add
      .sprite(0, -16, key, 0)
      .setScale(SPRITE_SCALE)
      .setOrigin(0.5, 0.5);
    sprite.play(`${key}-walk-down`);

    const nameText = this.add
      .text(0, CARD_H / 2 - 20, label, {
        fontSize: "14px",
        color: "#ffffff",
      })
      .setOrigin(0.5);

    card.add([bg, sprite, nameText]);
    card.setSize(CARD_W, CARD_H);
    card.setInteractive();
    card.on("pointerdown", () => {
      this.selectIndex(index);
    });

    return card;
  }

  private buildPlayButton(): Phaser.GameObjects.Container {
    const btn = this.add.container(0, 0);

    const bg = this.add
      .rectangle(0, 0, 140, 44, COLOR_SELECTED, 0.15)
      .setStrokeStyle(2, COLOR_SELECTED);

    const label = this.add
      .text(0, 0, "Ir al mapa", {
        fontSize: "18px",
        color: COLOR_GOLD_TEXT,
        fontStyle: "bold",
      })
      .setOrigin(0.5);

    btn.add([bg, label]);
    btn.setSize(140, 44);
    btn.setInteractive();
    btn.on("pointerdown", () => this.startGame());
    btn.on("pointerover", () => bg.setFillStyle(COLOR_SELECTED, 0.3));
    btn.on("pointerout", () => bg.setFillStyle(COLOR_SELECTED, 0.15));

    return btn;
  }

  private positionCards() {
    const totalW =
      CHARACTERS.length * CARD_W + (CHARACTERS.length - 1) * CARD_GAP;
    const startX = -totalW / 2 + CARD_W / 2;
    this.cards.forEach((card, i) => {
      card.setPosition(startX + i * (CARD_W + CARD_GAP), 0);
    });
  }

  private selectIndex(index: number) {
    this.selectedIndex = index;
    this.refreshSelection();
  }

  private refreshSelection() {
    this.cards.forEach((card, i) => {
      const bg = card.getAt(0) as Phaser.GameObjects.Rectangle;
      if (i === this.selectedIndex) {
        bg.setStrokeStyle(3, COLOR_SELECTED);
        bg.setFillStyle(COLOR_SELECTED, 0.15);
      } else {
        bg.setStrokeStyle(3, COLOR_UNSELECTED);
        bg.setFillStyle(COLOR_UNSELECTED, 0.7);
      }
    });
  }

  private repositionUI() {
    const { width, height } = this.scale;
    this.container.setPosition(width / 2, height / 2);

    // Re-draw full-screen background
    const bg = this.children.getAt(0) as Phaser.GameObjects.Rectangle;
    bg.setSize(width, height);
  }

  private startGame() {
    const character = CHARACTERS[this.selectedIndex].key;
    this.scene.start("Game", { character, festivalId: this.festivalId });
  }
}
