// Drive the same secondary-tools menu that a person uses.
export async function clickPageTool(page, name) {
  const menu = page.locator('.page-info');
  if ((await menu.getAttribute('open')) === null) await menu.locator(':scope > summary').click();
  await menu.getByRole('button', { name, exact: true }).click();
}
