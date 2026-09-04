import re, json, sys

src = open(sys.argv[1], encoding='utf-8', errors='replace').read()

blocks = re.findall(r'const QStringList (schema\d+)\s*=\s*\{(.*?)\n    \};', src, re.S)
print("blocks found:", [b[0] for b in blocks])

STR = r'"((?:[^"\\]|\\.)*)"'
LIT = r'QStringLiteral\(\s*((?:' + STR + r'\s*)+)\)'

out = {}
for name, body in blocks:
    stmts = []
    for m in re.finditer(LIT, body):
        parts = re.findall(STR, m.group(1))
        s = ''.join(parts)
        s = s.replace('\\"', '"').replace("\\'", "'")
        stmts.append(' '.join(s.split()))
    out[name] = stmts
    tables = sum(1 for s in stmts if 'CREATE TABLE' in s)
    print(f"  {name}: {len(stmts)} statements, {tables} CREATE TABLE")

json.dump(out, open(sys.argv[2], 'w'), indent=1)
total = sum(len(v) for v in out.values())
tables = sum(1 for v in out.values() for s in v if 'CREATE TABLE' in s)
print("TOTAL:", total, "statements |", tables, "CREATE TABLE")
