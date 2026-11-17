import re

p = 'download_istanbul_map.py'
s = open(p).read()

old = '''    "full":     ("~39k tiles / ~1.5 GB — Istanbul at every zoom", [
                    (ISTANBUL_METRO, 0, 19)
                ]),'''

new = '''    "full":     ("~39k tiles / ~1.5 GB — Istanbul at every zoom (up to z19)", [
                    (ISTANBUL_METRO, 0, 13),
                    (ISTANBUL_CORE,  10, 19),
                ]),'''

assert old in open(p).read(), "Old pattern not found"
s = s.replace(old, new)
open(p, 'w').write(s)
print("Fixed full preset")

import ast
ast.parse(open('download_istanbul_map.py').read())
print('syntax OK')