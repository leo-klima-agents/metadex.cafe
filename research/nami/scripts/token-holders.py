# Rebuilds an ERC-20's balances on Base from its Transfer logs, in 10,000-block chunks, and prints the largest holders.
# Usage: BASE_RPC_URL=... python3 token-holders.py <token> <a block before its deployment> [decimals]
# It writes the raw logs to logs_<token prefix>.json in the current directory.
import json, os, sys, urllib.request, concurrent.futures as cf, time
rpc = os.environ["BASE_RPC_URL"]
token = sys.argv[1].lower(); start = int(sys.argv[2]); dec = int(sys.argv[3]) if len(sys.argv) > 3 else 18
TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
def call(method, params):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    for attempt in range(6):
        try:
            req = urllib.request.Request(rpc, data=body, headers={"content-type": "application/json", "user-agent": "research"})
            r = json.load(urllib.request.urlopen(req, timeout=60))
            if "error" in r: raise RuntimeError(str(r["error"])[:200])
            return r["result"]
        except Exception as e:
            err = e; time.sleep(1 + attempt)
    raise err
latest = int(call("eth_blockNumber", []), 16)
# find deployment block by binary search on code
lo, hi = start, latest
if call("eth_getCode", [token, hex(lo)]) not in ("0x", None):
    pass
else:
    while lo + 1 < hi:
        mid = (lo + hi) // 2
        if call("eth_getCode", [token, hex(mid)]) in ("0x", None): lo = mid
        else: hi = mid
    start = hi
print("deploy block ~", start, "latest", latest, file=sys.stderr)
ranges = [(a, min(a + 9999, latest)) for a in range(start, latest + 1, 10000)]
def get(rg):
    return call("eth_getLogs", [{"address": token, "topics": [TOPIC], "fromBlock": hex(rg[0]), "toBlock": hex(rg[1])}])
logs = []
with cf.ThreadPoolExecutor(8) as ex:
    for res in ex.map(get, ranges): logs.extend(res)
bal = {}
for l in logs:
    f = "0x" + l["topics"][1][26:]; t = "0x" + l["topics"][2][26:]; v = int(l["data"], 16)
    bal[f] = bal.get(f, 0) - v; bal[t] = bal.get(t, 0) + v
print("transfers:", len(logs), "holders>0:", sum(1 for v in bal.values() if v > 0))
first = sorted(logs, key=lambda l: (int(l["blockNumber"], 16), int(l["logIndex"], 16)))[:6]
for l in first: print("  first:", int(l["blockNumber"], 16), "0x" + l["topics"][1][26:], "->", "0x" + l["topics"][2][26:], int(l["data"], 16) / 10**dec, l["transactionHash"])
for a, v in sorted(bal.items(), key=lambda kv: -kv[1])[:15]: print(f"  {a} {v/10**dec:,.4f}")
z = "0x" + "0"*40
print("minted:", -bal.get(z, 0) / 10**dec if bal.get(z, 0) < 0 else 0, "net zero-address:", bal.get(z, 0) / 10**dec)
json.dump(logs, open(f"logs_{token[:8]}.json", "w"))
