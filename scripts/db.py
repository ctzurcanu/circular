"""Local PostgreSQL transport, using installed psql and no Python dependencies."""
import json
import os
import subprocess


def literal(value):
    if value is None:
        return 'NULL'
    if isinstance(value, (int, float)):
        return str(value)
    # PostgreSQL standard_conforming_strings is enabled explicitly below.
    return "'" + str(value).replace("'", "''") + "'"


def execute(sql, json_result=False):
    result = subprocess.run(
        ['psql', '-X', '-h', os.environ.get('PGHOST','localhost'),
         '-p', os.environ.get('PGPORT','5432'), '-d', os.environ.get('PGDATABASE','biz'),
         '-v', 'ON_ERROR_STOP=1', '-q', '-A', '-t'],
        input='SET standard_conforming_strings = on;\n' + sql,
        text=True, capture_output=True,
    )
    if result.returncode:
        raise RuntimeError(result.stderr.strip())
    if json_result:
        return json.loads(result.stdout.strip())
    return result.stdout.strip()
