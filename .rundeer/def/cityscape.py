import random
from pathlib import Path


def load_words(filename):
    path = Path(__file__).parent / "vocab" / filename
    with open(path, encoding="utf-8") as f:
        words = [line.strip().lower() for line in f if line.strip() and not line.startswith("#")]
    return [w for w in words if len(w) > 2]


def cityscape():
    urban_adjs = load_words("urban_adjectives.txt")
    urban_nouns = load_words("urban_nouns.txt")
    urban_concepts = load_words("urban_concepts.txt")
    colors = load_words("colors.txt")


    times = ["twilight", "midnight", "dawn", "blue hour", "golden pollution glow", "pouring rain", "humid summer night", "fog shrouded", "heatwave mirage", "witching hour"]
    macro_elements = ["monolithic skyscrapers", "dilapidated high-rises", "brutalist towers piercing the haze", "neon-drenched office blocks", "graffiti-scarred tenements", "crumbling warehouses with rooftop coops"]
    decay_phrases = ["layered palimpsest of peeling posters and murals", "fire escapes tangled with laundry and extension cords", "balconies overflowing with wild plants and rusted grills", "windows patched with cardboard and plastic sheeting", "satellite dishes forming chaotic skyline forests"]
    street_pools = ["overflowing gutters swirling with oil slicks", "potholed sidewalks sprouting resilient weeds", "litter-choked alleys", "cracked pavements with faded chalk drawings", "steam-venting manholes", "leaking fire hydrants pooling rusty water"]
    wildlife_pools = ["bold scavenging rats dragging scraps", "mangy pigeons fighting over fries", "swarms of cockroaches in shadows", "feral cats perched on dumpsters", "scurrying raccoons", "flocks of starlings on wires"]
    commercial_pools = ["flickering vape shops and bodegas", "dilapidated fast-food joints with barred windows", "24-hour pawn shops and liquor stores", "greasy laundromats and check-cashing outlets", "street vendors with tarpaulin carts"]
    lighting_pools = ["erratic neon signs casting distorted reflections", "buzzing fluorescent tubes and sodium lamps", "glitching holographic ads and cracked LED billboards", "bare bulb strings over vendor stalls"]
    micro_details = ["moss and tiny mushrooms in every crack", "condensation on grimy windows forming patterns", "spiderwebbed glass and peeling paint revealing rust", "faded protest stickers, gang tags, and missing pet flyers", "rainbow oil on puddles mirroring the chaos", "wildflowers and chalk remnants pushing through asphalt"]
    unique_anomalies = ["overturned barricades from last night's protest", "abandoned strollers filled with belongings", "ghost bike memorials wrapped in flowers", "illegal rooftop party remnants with fairy lights", "drone crash sites amid EV scooter graveyards", "AR graffiti overlays hacking billboards", "bitcoin atm with heist damage", "pop-up underground club entrance hidden behind dumpsters", "community mural depicting local legends next to burnt-out cars"]
    sound_smell_pools = ["distant sirens competing with bass thumps", "tinny radios and busker guitars echoing", "acrid grilled meat mixed with diesel and ozone", "garbage stench and wet concrete after rain", "mechanical subway clatter and shouting vendors", "faint burnt rubber and fried food wafting", "rhythmic thump from tinted cars and mechanical hums"]


    templates = [
        "A {adj} dirty modern cityscape sprawls under a brooding {color} {time} sky, where {macro} thrust upward like jagged teeth, their {decay} facades telling centuries of urban stories through overlapping {adj} graffiti, torn posters, and intricate street murals.",
        "Upper levels reveal broken windows boarded haphazardly, rooftops cluttered with pigeon coops, tangled antennas, and makeshift gardens gone feral against the {adj} haze.",
        "At street level, {street} form a {adj} labyrinth choked with {adj} litter, {micro}, while {wildlife} navigate the detritus with surprising boldness amid passing weary commuters.",
        "{commercial} pulse with erratic {lighting}, their glows reflecting in rain-slicked puddles and oil rainbows that distort every silhouette and neon sign.",
        "Homeless encampments of tarps, cardboard, and overloaded shopping carts line the curbs, small cooking fires sending up {concept} as battery radios play tinny music into the night.",
        "Zooming into the fractal details exposes {micro} where tiny ecosystems thrive in the grime—{adj} {noun} sprouting from rotting wood or concrete fissures.",
        "Utility poles disappear under layers of overlapping flyers for raves, missing pets, protests, and payday loans; every surface etched with scratched phone numbers, faded gang symbols, and children's chalk drawings now {adj} by weather.",
        "Abandoned vehicles on flattened tires with {adj} spiderwebbed windshields sit as monuments, their interiors overflowing with fast food debris and old newspapers.",
        "The air vibrates with {sound} while {unique} add unexpected narrative layers—perhaps a street performer spinning flaming poi or an AR hack glitching across a billboard.",
        "This resilient metropolis pulses with contradictions: beauty in {color} puddle reflections and wildflowers in asphalt cracks, resilience amid {adj} decay, where every macro tower down to microscopic mold patterns forms a living, breathing tapestry of gritty urban existence.",
        "Sudden details emerge like {unique} or {concept} that shift the scene's mood entirely, from quiet desperation to vibrant street life under {lighting}.",
        "The gutters swirl with cigarette ash, floating lottery tickets, plastic bags, and the occasional {noun}, carrying stories downstream into clogged drains.",
        "Distant {concept} blends with the mechanical clatter of subways below and the flap of tarpaulins in the {adj} breeze, creating an immersive symphony of city survival.",
        "In this {adj} world, {wildlife} and humans coexist in uneasy harmony around {commercial}, each {micro} revealing another layer of history and adaptation.",
        "From the monolithic scale of the skyline to the intimate textures of moss-filled cracks and shimmering reflections, the city reveals its {adj} soul—one of unyielding spirit hidden in layers of grime and neon."
    ]


    selected = random.sample(templates, k=random.randint(8, 11))
    random.shuffle(selected)


    parts = {
        "adj": random.choice(urban_adjs),
        "color": random.choice(colors),
        "time": random.choice(times),
        "macro": random.choice(macro_elements),
        "decay": random.choice(decay_phrases),
        "street": random.choice(street_pools),
        "wildlife": random.choice(wildlife_pools),
        "commercial": random.choice(commercial_pools),
        "lighting": random.choice(lighting_pools),
        "micro": random.choice(micro_details),
        "unique": random.choice(unique_anomalies),
        "sound": random.choice(sound_smell_pools),
        "concept": random.choice(urban_concepts),
        "noun": random.choice(urban_nouns)
    }


    paragraphs = []
    for template in selected:
        filled = template.format(**parts)
        paragraphs.append(filled)

    description = "\n\n".join(paragraphs)
    return description


if __name__ == "__main__":
    print(cityscape())
