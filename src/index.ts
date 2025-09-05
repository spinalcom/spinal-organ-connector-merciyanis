/*
 * Copyright 2021 SpinalCom - www.spinalcom.com
 *
 * This file is part of SpinalCore.
 *
 * Please read all of the following terms and conditions
 * of the Free Software license Agreement ("Agreement")
 * carefully.
 *
 * This Agreement is a legally binding contract between
 * the Licensee (as defined below) and SpinalCom that
 * sets forth the terms and conditions that govern your
 * use of the Program. By installing and/or using the
 * Program, you agree to abide by all the terms and
 * conditions stated or referenced herein.
 *
 * If you do not agree to abide by these terms and
 * conditions, do not demonstrate your acceptance and do
 * not install or use the Program.
 * You should have received a copy of the license along
 * with this file. If not, see
 * <http://resources.spinalcom.com/licenses.pdf>.
 */
require("axios-debug-log");

import { OrganProcess } from "./processes/OrganProcess";
import { startServer } from "./server";

async function main() {
  const organ = new OrganProcess();
  await organ.init();

  const { server } = await startServer(); // uses PORT or defaults to 8443

  organ.run();;
}

main().catch((err) => {
  console.error("[fatal] boot failed:", err);
  process.exit(1);
});
