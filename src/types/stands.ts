export type FestivalStand = {
  standId: number;
  standLabel: string | null;
  standNumber: number;
  standDisplayLabel: string;
  participants: {
    participantId: number;
    imageUrl: string | null;
    displayName: string | null;
    category: string | null;
    socials: { type: string; username: string }[];
  }[];
};
