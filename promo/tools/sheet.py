# Contact sheet: python3 tools/sheet.py out.png cols width file1 file2 ...
import subprocess, sys
out, cols, width, files = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4:]
inputs, filters, parts = [], [], []
h = round(width * 16 / 9)
for i, f in enumerate(files):
    inputs += ["-i", f]
    filters.append(f"[{i}]scale={width}:{h}:force_original_aspect_ratio=decrease,pad={width}:{h}:(ow-iw)/2:(oh-ih)/2[i{i}]")
    parts.append(f"[i{i}]")
while len(parts) % cols:
    n = len(parts); filters.append(f"color=black:s={width}x{h}:d=1[p{n}]"); parts.append(f"[p{n}]")
rows = []
for r in range(len(parts) // cols):
    filters.append("".join(parts[r*cols:(r+1)*cols]) + (f"hstack={cols}" if cols > 1 else "null") + f"[r{r}]"); rows.append(f"[r{r}]")
filters.append("".join(rows) + (f"vstack={len(rows)}" if len(rows) > 1 else "null") + "[out]")
subprocess.run(["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", ";".join(filters), "-map", "[out]", "-frames:v", "1", out], check=True)
