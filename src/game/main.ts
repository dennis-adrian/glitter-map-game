import { Game as MainGame } from "./scenes/Game";
import { CharacterSelect } from "./scenes/CharacterSelect";
import { FestivalSelect } from "./scenes/FestivalSelect";
import { AUTO, Game, Scale, Types } from "phaser";
import { uiTheme } from "./theme";

// Find out more information about the Game Config at:
// https://docs.phaser.io/api-documentation/typedef/types-core#gameconfig
const config: Types.Core.GameConfig = {
  type: AUTO,
  width: window.innerWidth,
  height: window.innerHeight,
  parent: "game-container",
  backgroundColor: uiTheme.hex.bgCanvas,
  physics: {
    default: "arcade",
    arcade: {
      gravity: { x: 0, y: 0 },
      debug: false,
    },
  },
  scale: {
    mode: Scale.RESIZE,
    autoCenter: Scale.CENTER_BOTH,
  },
  scene: [FestivalSelect, CharacterSelect, MainGame],
};

const StartGame = (parent: string) => {
  return new Game({ ...config, parent });
};

export default StartGame;
