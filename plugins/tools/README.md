# Plugin tools

## validate-plugins.js

Checks a plugin before you install, share or upload it. It needs Node 20 or newer and nothing else.

```
node plugins/tools/validate-plugins.js path/to/my-plugin
node plugins/tools/validate-plugins.js plugins/ssa-plugins plugins/examples
```

Give it one plugin folder, or a folder that holds several. It reads files and never changes one.

What it checks:

- **plugin.json**: valid JSON, an `id` that matches the folder, a `name`, a `type`, an `x.y.z` version, an `x.y.z` `minManagerVersion`, `capabilities` written as words, and `dependencies` and `bridge` in the right shape.
- **Files the manifest names**: `main`, `web`, `fc`, `config`, `image` and `readme` exist and stay inside the plugin. A `README.md` is there. An `icon.png` is named in `image`.
- **Translations** in `payload/web/i18n`: every file is valid, flat JSON for a language the panel has, with no `en.json`. Every key the code asks for through `SSA.t()`, `FC.t()` or `host.i18n.t()` is in every language, and no file carries a key nobody asks for. No value is empty. Each one keeps the `{placeholders}` and the leading or trailing space of its English. Counts have real plural forms.
- **The packed zip**: when `dist/<id>-<version>.zip` exists, it is read and compared with the source byte for byte.

It ends with `valid: ...` and exit code 0, or a list of findings and exit code 1. Warnings do not fail the run unless you add `--strict`. `--quiet` prints only the plugins that have something to say.

Passing means the plugin is shaped the way the manager and the [library](https://scumsa.com/mods/) expect. It does not run your code, so test that in your own manager too.

## test-validate-plugins.js

Breaks a copy of `examples/hello-plugin` one rule at a time and checks that the validator catches each one. Run it after changing the validator.
