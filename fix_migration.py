import re

# Read the migration file
with open(r'api\alembic\versions\54fda11a96b5_initial_schema.py', 'r') as f:
    content = f.read()

# Remove server_default=sa.text('gen_random_uuid()') from UUID columns
content = re.sub(
    r", server_default=sa\.text\('gen_random_uuid\(\)'\)",
    "",
    content
)

# Write back
with open(r'api\alembic\versions\54fda11a96b5_initial_schema.py', 'w') as f:
    f.write(content)

print("Fixed migration file - removed server_default from UUID columns")
