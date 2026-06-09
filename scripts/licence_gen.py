#!/usr/bin/env python3
"""
Effro licence key generator / minter / verifier - VENDOR-ONLY, run offline.

This tool is NOT shipped in the app or the PyInstaller bundle. It lives in the
repo only as operator tooling. The Ed25519 PRIVATE key it produces is the crown
jewel: keep it in the vendor secret store, never commit it, never paste it into
a chat or CI log. Only the matching PUBLIC key is baked into
backend/licence_manager.py for offline verification.

Token format (must match backend/licence_manager.py):
    effro-lic-v1.<base64url(payload_json)>.<base64url(ed25519_sig)>
The signature is over the exact payload_json bytes that are base64url-encoded
into the token, so verification needs no canonicalisation.

Usage:
    python scripts/licence_gen.py keygen [--out-private dev_key.pem]
        Generate a new Ed25519 keypair. Prints the PUBLIC key (base64, raw 32
        bytes) to bake into PUBLIC_KEYS. Writes the PRIVATE key to a file if
        --out-private is given, otherwise prints it (dev only).

    python scripts/licence_gen.py mint --private dev_key.pem \
        --customer-id acme --customer-name "ACME Corp" --edition enterprise \
        --seats 25 --expires 2027-06-01 [--issued 2026-06-01] \
        [--grace-days 30] [--key-id lic_2026_acme_001]
        Prints an effro-lic-v1 token.

    python scripts/licence_gen.py verify --public <PUB_B64> --token effro-lic-v1....
        Verifies the signature and prints the claims.
"""
import argparse
import base64
import datetime
import json
import sys

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey, Ed25519PublicKey,
)
from cryptography.exceptions import InvalidSignature

PREFIX = "effro-lic-v1"


def _b64u(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode("ascii")


def _b64u_dec(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def keygen(args):
    priv = Ed25519PrivateKey.generate()
    pem = priv.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode()
    pub_raw = priv.public_key().public_bytes(
        serialization.Encoding.Raw, serialization.PublicFormat.Raw,
    )
    pub_b64 = base64.b64encode(pub_raw).decode()
    if args.out_private:
        with open(args.out_private, "w", encoding="utf-8") as f:
            f.write(pem)
        print(f"# private key written to {args.out_private} (keep secret, never commit)")
    else:
        print("# PRIVATE KEY (PEM) - keep secret, never commit:")
        print(pem)
    print("# PUBLIC KEY (base64 raw) - bake into licence_manager.PUBLIC_KEYS:")
    print(pub_b64)


def mint(args):
    with open(args.private, "rb") as f:
        priv = serialization.load_pem_private_key(f.read(), password=None)
    if not isinstance(priv, Ed25519PrivateKey):
        sys.exit("private key is not Ed25519")
    claims = {
        "v": 1,
        "key_id": args.key_id or f"lic_{args.customer_id}",
        "customer_id": args.customer_id,
        "customer_name": args.customer_name,
        "edition": args.edition,
        "seats": args.seats,
        "issued_at": args.issued or datetime.date.today().isoformat(),
        "expires_at": args.expires,
        "grace_days": args.grace_days,
    }
    payload = json.dumps(claims, separators=(",", ":")).encode("utf-8")
    sig = priv.sign(payload)
    print(f"{PREFIX}.{_b64u(payload)}.{_b64u(sig)}")


def verify(args):
    pub = Ed25519PublicKey.from_public_bytes(base64.b64decode(args.public))
    try:
        prefix, payload_b64, sig_b64 = args.token.strip().split(".", 2)
    except ValueError:
        sys.exit("malformed token")
    if prefix != PREFIX:
        sys.exit(f"bad prefix (expected {PREFIX})")
    payload = _b64u_dec(payload_b64)
    try:
        pub.verify(_b64u_dec(sig_b64), payload)
    except InvalidSignature:
        sys.exit("INVALID signature")
    print("VALID:")
    print(json.dumps(json.loads(payload), indent=2))


def main():
    p = argparse.ArgumentParser(description="Effro licence tool (vendor-only)")
    sub = p.add_subparsers(dest="cmd", required=True)

    g = sub.add_parser("keygen")
    g.add_argument("--out-private", help="write the private key PEM here instead of printing")
    g.set_defaults(func=keygen)

    m = sub.add_parser("mint")
    m.add_argument("--private", required=True)
    m.add_argument("--customer-id", required=True)
    m.add_argument("--customer-name", required=True)
    m.add_argument("--edition", choices=["pro", "enterprise"], default="pro")
    m.add_argument("--seats", type=int, default=None)
    m.add_argument("--expires", required=True, help="YYYY-MM-DD")
    m.add_argument("--issued", help="YYYY-MM-DD (default today)")
    m.add_argument("--grace-days", type=int, default=30)
    m.add_argument("--key-id")
    m.set_defaults(func=mint)

    v = sub.add_parser("verify")
    v.add_argument("--public", required=True)
    v.add_argument("--token", required=True)
    v.set_defaults(func=verify)

    args = p.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
