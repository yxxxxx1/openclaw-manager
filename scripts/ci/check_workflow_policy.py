"""Offline invariants for local-first development and mandatory checkpoint CI.

Uses only the Python standard library. Run before opening/readying a PR and
inside the existing checkpoint jobs; draft runs must allocate no new runner.
"""
import ast
from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[2]
EVENTS = {"opened", "synchronize", "reopened", "ready_for_review", "converted_to_draft"}
ALLOWED_AST = (
    ast.Expression, ast.BoolOp, ast.Or, ast.And, ast.UnaryOp, ast.Not,
    ast.Compare, ast.Eq, ast.NotEq, ast.Constant,
)


def run_condition(expression, event, draft):
    """Evaluate the deliberately small boolean subset used by job guards."""
    value = expression.removeprefix("${{").removesuffix("}}").strip()
    value = value.replace("github.event.pull_request.draft", repr(draft))
    value = value.replace("github.event_name", repr(event))
    value = re.sub(r"\bfalse\b", "False", value)
    value = re.sub(r"\btrue\b", "True", value)
    value = value.replace("||", " or ").replace("&&", " and ")
    tree = ast.parse(value, mode="eval")
    assert all(isinstance(node, ALLOWED_AST) for node in ast.walk(tree)), expression
    return bool(eval(compile(tree, "<workflow-condition>", "eval"), {"__builtins__": {}}, {}))


def check_workflow(path):
    text = path.read_text(encoding="utf-8")
    if not re.search(r"^  pull_request:\s*$", text, re.M):
        return 0  # Production, recovery and reusable workflows are independent.
    trigger, jobs_text = text.split("\njobs:\n", 1)
    pr = re.search(r"^  pull_request:\n(.*?)(?=^  \S|\Z)", trigger, re.M | re.S).group(1)
    types = re.search(r"^    types: \[([^\]]+)\]$", pr, re.M)
    assert types and {item.strip() for item in types.group(1).split(",")} == EVENTS, path
    assert re.search(r"^  push:", trigger, re.M), f"main/tag checks removed: {path}"
    assert "paths-ignore:" not in trigger and not re.search(r"^    paths:", trigger, re.M), path
    assert "pull_request_target:" not in trigger, f"PR code must not gain trusted authority: {path}"
    roots = 0
    for match in re.finditer(r"^  ([\w-]+):\n(.*?)(?=^  [\w-]+:\n|\Z)", jobs_text, re.M | re.S):
        job, body = match.groups()
        if re.search(r"^    needs:", body, re.M):
            continue  # Existing dependency/result gates stay intact.
        condition = re.search(r"^    if: (.+)$", body, re.M)
        assert condition, f"unguarded root job {job}: {path}"
        expression = condition.group(1)
        for event, draft, expected in [
            ("pull_request", True, False),
            ("pull_request", False, True),
            ("push", False, True),
            ("push", True, True),
            ("workflow_dispatch", False, True),
            ("workflow_dispatch", True, True),
        ]:
            assert run_condition(expression, event, draft) == expected, (path, job, event, draft)
        roots += 1
    assert roots, f"no checkpoint job found: {path}"
    print(f"PASS {path.name}: {roots} root job(s); drafts local, ready/main/manual checkpoints enabled")
    return 1


def main():
    count = sum(check_workflow(path) for path in sorted((ROOT / ".github/workflows").glob("*.yml")))
    assert count, "No local-first PR workflows found"
    print(f"PASS {count} workflow(s); no production operation was executed")


if __name__ == "__main__":
    main()
