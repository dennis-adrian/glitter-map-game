import { Scene } from "phaser";
import { uiTheme } from "../theme";

const FESTIVALS = [{ id: 484, name: "Festival Glitter 9na Edición" }];

const CARD_W = 220;
const CARD_H = 80;
const VERTICAL_GAP = 12;

export class FestivalSelect extends Scene {
  private selectedIndex = 0;
  private cards: Phaser.GameObjects.Container[] = [];
  private container!: Phaser.GameObjects.Container;

  private handleStartFestival = () => this.startFestival();
  private handleRepositionUI = () => this.repositionUI();

  constructor() {
    super("FestivalSelect");
  }

  create() {
    this.buildUI();

    this.input.keyboard?.on("keydown-ENTER", this.handleStartFestival);
    this.input.keyboard?.on("keydown-SPACE", this.handleStartFestival);
    this.scale.on("resize", this.handleRepositionUI);

    this.events.on("shutdown", this.cleanup, this);
  }

  private cleanup() {
    this.input.keyboard?.off("keydown-ENTER", this.handleStartFestival);
    this.input.keyboard?.off("keydown-SPACE", this.handleStartFestival);
    this.scale.off("resize", this.handleRepositionUI);
    this.events.off("shutdown", this.cleanup, this);
  }

  private buildUI() {
    const { width, height } = this.scale;

    this.add
      .rectangle(0, 0, width, height, uiTheme.colors.bgCanvas)
      .setOrigin(0);

    this.container = this.add.container(width / 2, height / 2);

    const totalCardsHeight =
      FESTIVALS.length * CARD_H + (FESTIVALS.length - 1) * VERTICAL_GAP;
    const cardsStartY = -totalCardsHeight / 2 + CARD_H / 2;

    const title = this.add
      .text(0, cardsStartY - CARD_H / 2 - 48, "Selecciona un festival", {
        fontSize: "22px",
        color: uiTheme.text.accent,
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    this.container.add(title);

    this.cards = FESTIVALS.map(({ name }, i) => {
      const card = this.buildCard(name, i);
      card.y = cardsStartY + i * (CARD_H + VERTICAL_GAP);
      this.container.add(card);
      return card;
    });

    const exploreBtn = this.buildExploreButton();
    exploreBtn.setPosition(0, cardsStartY + totalCardsHeight - CARD_H / 2 + 48);
    this.container.add(exploreBtn);

    this.refreshSelection();
  }

  private buildCard(name: string, index: number): Phaser.GameObjects.Container {
    const card = this.add.container(0, 0);

    const bg = this.add
      .rectangle(
        0,
        0,
        CARD_W,
        CARD_H,
        uiTheme.colors.surface,
        uiTheme.alpha.unselected,
      )
      .setStrokeStyle(3, uiTheme.colors.border);

    const label = this.add
      .text(0, 0, name, {
        fontSize: "16px",
        color: uiTheme.text.primary,
        align: "center",
        wordWrap: { width: CARD_W - 24 },
      })
      .setOrigin(0.5);

    card.add([bg, label]);
    card.setSize(CARD_W, CARD_H);
    card.setInteractive();
    card.on("pointerdown", () => {
      this.selectedIndex = index;
      this.refreshSelection();
    });

    return card;
  }

  private buildExploreButton(): Phaser.GameObjects.Container {
    const btn = this.add.container(0, 0);

    const bg = this.add
      .rectangle(0, 0, 140, 44, uiTheme.colors.surface, uiTheme.alpha.button)
      .setStrokeStyle(2, uiTheme.colors.borderStrong);

    const label = this.add
      .text(0, 0, "Explorar", {
        fontSize: "18px",
        color: uiTheme.text.accent,
        fontStyle: "bold",
      })
      .setOrigin(0.5);

    btn.add([bg, label]);
    btn.setSize(140, 44);
    btn.setInteractive();
    btn.on("pointerdown", () => this.startFestival());
    btn.on("pointerover", () => bg.setFillStyle(uiTheme.colors.accentSoft, 1));
    btn.on("pointerout", () =>
      bg.setFillStyle(uiTheme.colors.surface, uiTheme.alpha.button),
    );

    return btn;
  }

  private refreshSelection() {
    this.cards.forEach((card, i) => {
      const bg = card.getAt(0) as Phaser.GameObjects.Rectangle;
      const label = card.getAt(1) as Phaser.GameObjects.Text;
      if (i === this.selectedIndex) {
        bg.setStrokeStyle(3, uiTheme.colors.borderStrong);
        bg.setFillStyle(uiTheme.colors.accentPrimary, uiTheme.alpha.selected);
        label.setColor(uiTheme.text.accent);
      } else {
        bg.setStrokeStyle(3, uiTheme.colors.border);
        bg.setFillStyle(uiTheme.colors.surface, uiTheme.alpha.unselected);
        label.setColor(uiTheme.text.primary);
      }
    });
  }

  private repositionUI() {
    const { width, height } = this.scale;
    this.container.setPosition(width / 2, height / 2);
    const bg = this.children.getAt(0) as Phaser.GameObjects.Rectangle;
    bg.setSize(width, height);
  }

  private startFestival() {
    const festival = FESTIVALS[this.selectedIndex];
    this.scene.start("CharacterSelect", { festivalId: festival.id });
  }
}
