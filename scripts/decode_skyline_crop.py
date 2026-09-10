#!/usr/bin/env python3
import base64, hashlib, pathlib
parts = sorted(pathlib.Path("scripts").glob("_skyline_b64_*.txt"))
assert parts, "no b64 parts"
b64 = "".join(p.read_text().strip() for p in parts)
data = base64.b64decode(b64)
h = hashlib.sha256(data).hexdigest()
assert h == "7a5b30403d68e7a763725789416628060d08274528fc36db1afbd0d3581e05c2", h
assert len(data) == 50803
out = pathlib.Path("public/demo/skyline-errenteria.png")
out.parent.mkdir(parents=True, exist_ok=True)
out.write_bytes(data)
print("OK", out, len(data), h)
