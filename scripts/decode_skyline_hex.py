#!/usr/bin/env python3
import hashlib, pathlib
parts = sorted(pathlib.Path("scripts").glob("_skyline_hex_*.txt"))
assert parts, "no hex parts"
hx = "".join(p.read_text().strip() for p in parts)
data = bytes.fromhex(hx)
h = hashlib.sha256(data).hexdigest()
assert h == "7a5b30403d68e7a763725789416628060d08274528fc36db1afbd0d3581e05c2", h
assert len(data) == 50803
out = pathlib.Path("public/demo/skyline-errenteria.png")
out.parent.mkdir(parents=True, exist_ok=True)
out.write_bytes(data)
print("OK", out, len(data), h)
