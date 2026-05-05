import random
from pathlib import Path

def load_words(filename):
    path = Path(__file__).parent / "vocab" / filename
    with open(path, encoding="utf-8") as f:
        words = [line.strip().lower() for line in f if line.strip() and not line.startswith("#")]
    return [w for w in words if len(w) > 2]


def random_symbol():
    adjectives = load_words("adjectives.txt")
    colors = load_words("colors.txt")
    nouns = load_words("nouns_original.txt")
    concepts = load_words("concepts.txt")
    t3_list = nouns + concepts
    t1 = random.choice(adjectives)
    t2 = random.choice(colors)
    t3 = random.choice(t3_list)
    return f"{t1} {t2} {t3}"


if __name__ == "__main__":
    print(random_symbol())
