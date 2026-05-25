(window.RundeerNodeResolvers = window.RundeerNodeResolvers || {})["time"] = async function (node, inputs, outputs, props, helpers) {
  const now = new Date();
  const fmt = String(props.format || "iso");
  switch (fmt) {
    case "unix":
      outputs.out = String(Math.floor(now.getTime() / 1000));
      break;
    case "human":
      outputs.out = now.toLocaleString();
      break;
    case "date":
      outputs.out = now.toISOString().split("T")[0];
      break;
    case "time":
      outputs.out = now.toTimeString().split(" ")[0];
      break;
    default:
      outputs.out = now.toISOString();
  }
};