export const SEMANTICS = `
## What the operator table cannot tell you

**\`c:\` vs \`id:\`** — \`c:\` is the colour of the mana cost. \`id:\` is commander colour identity,
which also counts mana symbols in the rules text. "Red cards" is \`c:r\`. "Cards I can play in my
Rakdos commander deck" is \`id<=rakdos\`. Getting this backwards is the single most common mistake.

**Colour comparisons are set operations.** \`c:rg\` means "contains red and green" (may have more).
\`c=rg\` means exactly red-green. \`c<=rg\` means "only red and/or green, possibly colourless".
For "cards playable in a deck of these colours" use \`<=\`.

**\`t:\` matches any substring of the type line.** \`t:legend\` finds Legendary; \`t:creature t:goblin\`
finds Goblin creatures. Multiple \`t:\` terms are ANDed. Do not invent hyphenated compound types.

**Multiple terms are ANDed** with a space. \`or\` must be written explicitly, and grouping needs
parentheses: \`(t:instant or t:sorcery) mv<=2\`. Without the parentheses the \`or\` binds only the
adjacent terms and the result is wrong.

**Negate with a leading \`-\`**: \`-c:u\` is "not blue", \`-is:reprint\` is "never reprinted".

**Quote any value containing a space**: \`kw:"double strike"\`, \`o:"draw a card"\`, \`a:"rebecca guay"\`.

**\`o:\` searches oracle text**, lowercase, and \`~\` stands in for the card's own name. Prefer a
short distinctive phrase over a long sentence — \`o:"draw a card"\` not \`o:"you may draw a card"\`.

**Rarity is ordered**, so \`r>=rare\` means rare or mythic.

**Use set codes, not set names.** \`set:neo\`, never \`set:"Kamigawa: Neon Dynasty"\`. Codes come from
the resolved entities block; if a set you need is not listed there, do not guess a code.

## Language rules

The person may write in Italian, English, German, French, or Spanish. The query you produce is
**always in English Scryfall syntax** — every operator and value is English regardless of the
input language.

**The language of the question is NOT a \`lang:\` filter.** Someone asking in German wants Magic
cards, not German printings. Only ever emit \`lang:\` when the person explicitly asks about the
language a card was *printed* in ("carte stampate in italiano", "auf Deutsch gedruckte Karten").

**Translate game vocabulary into its English term**: volare/Flugfähigkeit/vol/volar → \`kw:flying\`;
cavaliere/Ritter/chevalier/caballero → \`t:knight\`; istantaneo/Spontanzauber/éphémère/instantáneo →
\`t:instant\`. Never put a non-English word inside a filter value.

**Card names**: put the name as the person wrote it into \`detectedNames\` and use it in the query.
Localized names are converted to their English name afterwards, so you do not need to translate
them yourself — but you must list them.

**\`assumptions\`, \`unsupported\` and any explanation go back in the person's own language.**
The \`query\` itself never does.

## Interpreting vague wording

Vague quantities need a concrete filter, and every such choice goes in \`assumptions\`:
"cheap"/"economiche"/"billig" → \`mv<=3\`; "expensive" about money → \`usd>=20\`; "big creatures" →
\`pow>=5\`; "early game" → \`mv<=2\`. If a request cannot be expressed with the operators above —
card border, cube membership, EDHREC rank, art tags — leave it out of the query entirely and say
so in \`unsupported\`. Never approximate it with a filter that means something else, and never
silently drop it.

Return only filters the person actually asked for. Do not add \`t:creature\` because the example
looked like a creature search, and do not add \`f:commander\` unless commander was mentioned.
`.trim();
