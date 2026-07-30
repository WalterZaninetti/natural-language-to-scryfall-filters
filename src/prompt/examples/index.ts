export const LANGUAGES = ['en', 'it', 'de', 'fr', 'es'] as const;
export type Language = (typeof LANGUAGES)[number];

export interface Example {
  nl: string;
  query: string;
}

/** Chosen to cover operator families rather than topics. */
const EN: Example[] = [
  { nl: 'cheap red creatures with haste', query: 'c:r t:creature kw:haste mv<=3' },
  { nl: 'legendary green creatures with power 5 or more', query: 't:legendary t:creature c:g pow>=5' },
  { nl: 'cards that draw two cards', query: 'o:"draw two cards"' },
  { nl: 'what can I play in my azorius commander deck', query: 'f:commander id<=azorius' },
  { nl: 'instants or sorceries costing 2 or less', query: '(t:instant or t:sorcery) mv<=2' },
  { nl: 'creatures with flying that are not blue', query: 't:creature kw:flying -c:u' },
  { nl: 'mythics from Zendikar Rising', query: 'r:mythic set:znr' },
  { nl: 'rare or better modern-legal cards under five dollars', query: 'r>=rare f:modern usd<5' },
  { nl: 'artifacts that cost nothing', query: 't:artifact mv=0' },
  { nl: 'cards illustrated by Rebecca Guay', query: 'a:"rebecca guay"' },
  { nl: 'double-faced werewolves', query: 'is:dfc t:werewolf' },
  { nl: 'fetch lands', query: 'is:fetchland' },
  { nl: 'planeswalkers that start on 3 loyalty', query: 't:planeswalker loy=3' },
  { nl: 'cards banned in legacy', query: 'banned:legacy' },
  { nl: 'colorless creatures with mana value 6 or more', query: 'c:c t:creature mv>=6' },
  { nl: 'vanilla creatures that have never been reprinted', query: 'is:vanilla t:creature -is:reprint' },
  { nl: 'red removal, cheapest first', query: 'c:r o:destroy order:usd direction:asc' },
  { nl: 'cards with an izzet watermark', query: 'wm:izzet' },
  { nl: 'creatures from the original Kamigawa block', query: 't:creature block:chk' },
  { nl: 'cards whose name starts with Lightning', query: 'name:/^Lightning/' },
  { nl: 'green cards with an even mana value', query: 'c:g mv:even' },
  { nl: 'cards printed in Japanese', query: 'lang:ja' },
  { nl: 'creatures whose power is bigger than their toughness', query: 't:creature pow>tou' },
  { nl: 'commons from 2023 onwards', query: 'r:common year>=2023' },
];

const IT: Example[] = [
  { nl: 'creature rosse economiche con rapidità', query: 'c:r t:creature kw:haste mv<=3' },
  { nl: 'carte che pescano due carte', query: 'o:"draw two cards"' },
  { nl: 'creature leggendarie verdi con forza almeno 5', query: 't:legendary t:creature c:g pow>=5' },
  { nl: 'istantanei blu sotto i 5 euro', query: 'c:u t:instant eur<5' },
  { nl: 'carte stampate in italiano', query: 'lang:it' },
  { nl: 'cosa posso giocare nel mio mazzo commander golgari', query: 'f:commander id<=golgari' },
];

const DE: Example[] = [
  { nl: 'billige rote Kreaturen mit Eile', query: 'c:r t:creature kw:haste mv<=3' },
  { nl: 'Karten die zwei Karten ziehen', query: 'o:"draw two cards"' },
  { nl: 'legendäre Kreaturen mit Flugfähigkeit', query: 't:legendary t:creature kw:flying' },
  { nl: 'Zaubersprüche mit Manabetrag 1', query: '(t:instant or t:sorcery) mv=1' },
  { nl: 'auf Deutsch gedruckte Karten', query: 'lang:de' },
  { nl: 'Kreaturen aus Kamigawa: Neon Dynasty', query: 't:creature set:neo' },
];

const FR: Example[] = [
  { nl: 'créatures rouges pas chères avec célérité', query: 'c:r t:creature kw:haste mv<=3' },
  { nl: 'cartes qui piochent deux cartes', query: 'o:"draw two cards"' },
  { nl: 'créatures légendaires vertes avec force 5 ou plus', query: 't:legendary t:creature c:g pow>=5' },
  { nl: 'éphémères bleus à moins de 5 euros', query: 'c:u t:instant eur<5' },
  { nl: 'cartes imprimées en français', query: 'lang:fr' },
  { nl: 'terres qui cherchent une autre terre', query: 'is:fetchland' },
];

const ES: Example[] = [
  { nl: 'criaturas rojas baratas con prisa', query: 'c:r t:creature kw:haste mv<=3' },
  { nl: 'cartas que roban dos cartas', query: 'o:"draw two cards"' },
  { nl: 'criaturas legendarias verdes con fuerza 5 o más', query: 't:legendary t:creature c:g pow>=5' },
  { nl: 'instantáneos azules por menos de 5 euros', query: 'c:u t:instant eur<5' },
  { nl: 'cartas impresas en español', query: 'lang:es' },
  { nl: 'planeswalkers legales en pioneer', query: 't:planeswalker f:pioneer' },
];

export const EXAMPLES: Record<Language, Example[]> = { en: EN, it: IT, de: DE, fr: FR, es: ES };

export function renderExamples(): string {
  const blocks: string[] = [];
  for (const lang of LANGUAGES) {
    const lines = EXAMPLES[lang].map((ex) => `${ex.nl}\n→ ${ex.query}`);
    blocks.push(`### ${lang}\n${lines.join('\n\n')}`);
  }
  return blocks.join('\n\n');
}
