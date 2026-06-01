const getTime = () => new Date().toISOString();

const write = (level, message, meta) => {
  const payload = {
    time: getTime(),
    level,
    message,
    ...(meta ? { meta } : {}),
  };

  if (level === "error") {
    console.error(JSON.stringify(payload));
    return;
  }

  console.log(JSON.stringify(payload));
};

export const logger = {
  info(message, meta) {
    write("info", message, meta);
  },

  warn(message, meta) {
    write("warn", message, meta);
  },

  error(message, meta) {
    write("error", message, meta);
  },

  debug(message, meta) {
    write("debug", message, meta);
  },
};
