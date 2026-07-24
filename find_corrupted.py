import re

path = 'src/components/OfficeAdminPanel.tsx'
lines = open(path, 'rb').readlines()

print("File has", len(lines), "lines.")

# Search for invalid UTF-8 or replacement characters or truncated Nepali characters
for i, line in enumerate(lines):
    # Try decoding
    try:
        decoded = line.decode('utf-8')
        if '\ufffd' in decoded:
            print(f"Line {i+1} has replacement character: {repr(line)}")
    except UnicodeDecodeError as e:
        print(f"Line {i+1} has UnicodeDecodeError: {e} | {repr(line)}")

# Also look at specific lines reported by lint:
# 811, 883, 1011, 1023, 1035, 1047, 1205, 1246, 1363, 1382, 1679, 1713
reported_lines = [811, 883, 1011, 1023, 1035, 1047, 1205, 1246, 1363, 1382, 1679, 1713]
print("\n--- Reported Lines ---")
for rl in reported_lines:
    if rl-1 < len(lines):
        print(f"Line {rl}: {repr(lines[rl-1])}")
