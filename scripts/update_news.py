from urllib.request import Request, urlopen
from urllib.parse import quote
import xml.etree.ElementTree as ET
import json, html
from datetime import datetime, timezone
from pathlib import Path

# Free RSS search feed. No API key is required.
# Search is intentionally narrow to reduce unrelated IBD stories.
QUERY = quote('Crohn disease OR Crohn\'s disease')
URL = f"https://news.google.com/rss/search?q={QUERY}&hl=en-GB&gl=GB&ceid=GB:en"

req = Request(URL, headers={"User-Agent":"Mozilla/5.0 MyHealthNewsBot/1.0"})
with urlopen(req, timeout=20) as r:
    data = r.read()

root = ET.fromstring(data)
items = []
seen = set()

for item in root.findall(".//item"):
    title = html.unescape((item.findtext("title") or "").strip())
    link = (item.findtext("link") or "").strip()
    pub = (item.findtext("pubDate") or "").strip()
    source_el = item.find("source")
    source = (source_el.text or "").strip() if source_el is not None else "News"
    if not title or not link or title in seen:
        continue
    seen.add(title)
    items.append({"title":title,"link":link,"source":source,"published":pub})
    if len(items) >= 25:
        break

Path("news.json").write_text(json.dumps(items, indent=2, ensure_ascii=False))
print(f"Wrote {len(items)} headlines at {datetime.now(timezone.utc).isoformat()}")
