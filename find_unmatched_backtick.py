path = 'src/components/OfficeAdminPanel.tsx'
content = open(path, 'r', encoding='utf-8', errors='ignore').read()

in_backtick = False
backtick_start_line = 0
brace_stack = []

lines = content.split('\n')
for idx, line in enumerate(lines):
    line_num = idx + 1
    i = 0
    while i < len(line):
        char = line[i]
        if char == '\\':
            i += 2
            continue
        elif char == '`':
            if not in_backtick:
                in_backtick = True
                backtick_start_line = line_num
                print(f"Backtick opened at line {line_num}: {line.strip()[:60]}")
            else:
                in_backtick = False
                print(f"Backtick closed at line {line_num}: {line.strip()[:60]}")
        elif char == '$' and i + 1 < len(line) and line[i+1] == '{':
            if in_backtick:
                brace_stack.append(('expression', line_num))
                in_backtick = False
                i += 1
        elif char == '{':
            if not in_backtick:
                brace_stack.append(('brace', line_num))
        elif char == '}':
            if not in_backtick and brace_stack:
                state, start_l = brace_stack.pop()
                if state == 'expression':
                    in_backtick = True
        i += 1
