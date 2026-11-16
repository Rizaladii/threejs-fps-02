// The look plan, in one place. FOUNDRY is an industrial hall at dusk: charcoal steel,
// rust amber, hazard yellow and one cool teal for the defenders. Every colour in the
// game is one of these names; the same names are the CSS custom properties in index.html.
export const PALETTE = {
  canvas: '#0f1316', // dusk sky / fog
  surface: '#232a2e', // painted steel floor and walls
  hairline: '#3a444b', // beams, crates, dark steel
  ink: '#ece5d3', // warm off-white, markings and light
  muted: '#8b979e', // cool grey-blue, secondary steel
  accent: '#f2a33c', // molten amber: the attackers, the bomb, the kiln glow
  ember: '#e8642a', // attacker team colour
  teal: '#2fb3a3', // defender team colour
  danger: '#e23b2e', // damage, planted bomb, low health
  smoke: '#9aa4a8', // smoke grenade
};

export function shade(name) {
  return PALETTE[name];
}
