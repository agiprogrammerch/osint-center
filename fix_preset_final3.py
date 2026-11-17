s = open('download_istanbul_map.py', 'rb').read()

old = b'"full":     ("~39k tiles / ~1.5 GB \xe2\x80\x94 Istanbul at every zoom", [\n                    (ISTANBUL_METRO, 0, 19)\n                ]),'

new = b'    "full":     ("~39k tiles / ~1.5 GB \xe2\x80\x94 Istanbul at every zoom (up to z19)", [\n                    (ISTANBUL_METRO, 0, 13),\n                    (ISTANBUL_CORE,  10, 19),\n                ]),'

assert old in s, "Old pattern not found"
s = s.replace(old, new)
open('download_istanbul_map.py', 'wb').write(s)
print("Fixed full preset")

import ast
ast.parse(open('download_istanbul_map.py').read())
print('syntax OK')