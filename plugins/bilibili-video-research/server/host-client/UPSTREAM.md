# Vendored DFSC Host Client

`client.mjs`, `protocol.mjs` and their declarations are unmodified copies from
`examples/plugins/host-client/` in `7oMB2006/desktop-for-step-code` at commit
`2cb08065e936b81eebc9c4187fa46d823a010da0` (DFSC PR #264).

This pin includes stack-safe canonical Base64 validation for large media.
It does not change the wire format, size limits or validation strictness.

`../configuration.mjs` is the unmodified public `json-file-v1` reader from
`examples/plugins/config-starter/plugins/dfsc-config-example/server/` at commit
`0a03b3f80b497cad3d55531171ace8c7cb381bb3`. `LICENSE` applies to these vendored
files as well.
`../configuration.d.mts` remains BVR's local typing for the public reader.

This is a candidate protocol, not a released-host compatibility promise.
Keep the files and boundary tests together when updating the pinned source.
