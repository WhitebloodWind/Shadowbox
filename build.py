"""Combine src/ into a single self-contained index.html at the repo root."""
from pathlib import Path
root = Path(__file__).parent
src = root / "src"
shell = (src / "shell.html").read_text(encoding="utf-8")
out = (shell
       .replace("/*GEOM*/", (src / "geom.js").read_text(encoding="utf-8"))
       .replace("/*CASEGEN*/", (src / "casegen.js").read_text(encoding="utf-8"))
       .replace("/*APP*/", (src / "app1.js").read_text(encoding="utf-8") + "\n" + (src / "app2.js").read_text(encoding="utf-8")))
(root / "index.html").write_text(out, encoding="utf-8")
print(f"Wrote index.html ({len(out):,} bytes)")
