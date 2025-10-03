import { db } from './firebase.js';

const familyId = "defaultFamily";

const refs = {
    recipes: db.collection(`families/${familyId}/recipes`),
    meals: db.collection(`families/${familyId}/meals`),
    events: db.collection(`families/${familyId}/calendarEvents`),
    tasks: db.collection(`families/${familyId}/tasks`),
    groceries: db.collection(`families/${familyId}/groceries`),
    settings: db.collection(`families/${familyId}/settings`),
    csv: db.collection(`families/${familyId}/csv`)
};

function parseCSV(text) {
    const lines = text.split('\n');
    const headers = lines.shift().split(',').map(h => h.trim().replace(/"/g, ''));
    return lines.map(line => {
        if (!line.trim()) return null;
        const values = [];
        let current = '';
        let inQuotes = false;
        for (const char of line) {
            if (char === '"' && !inQuotes) { inQuotes = true; continue; }
            if (char === '"' && inQuotes) { inQuotes = false; continue; }
            if (char === ',' && !inQuotes) { values.push(current); current = ''; }
            else { current += char; }
        }
        values.push(current);
        const obj = {};
        headers.forEach((h, i) => obj[h] = values[i] || '');
        return obj;
    }).filter(Boolean);
}

async function processAndUploadCSV(csv) {
    const recipesData = parseCSV(csv);
    const batch = db.batch();
    const snap = await refs.recipes.get();
    snap.docs.forEach(doc => batch.delete(doc.ref));

    recipesData.forEach(recipe => {
        if (recipe.Plat) {
            if (recipe.Ingrédients && !recipe.Ingrédients.trim().startsWith('[')) {
                const ingredientsArray = recipe.Ingrédients.split('\n')
                    .map(line => line.trim())
                    .filter(line => line)
                    .map(line => ({ qte: '', unite: '', nom: line }));
                recipe.Ingrédients = JSON.stringify(ingredientsArray);
            }
            batch.set(refs.recipes.doc(), recipe);
        }
    });

    const today = new Date();
    const dayOfWeek = today.getDay();
    const daysUntilMonday = (dayOfWeek === 0) ? 1 : (8 - dayOfWeek);
    const nextMonday = new Date(today);
    nextMonday.setDate(today.getDate() + daysUntilMonday);
    nextMonday.setHours(0, 0, 0, 0);

    await refs.settings.doc('mealCycle').set({ startDate: nextMonday });
    await batch.commit();
    return nextMonday;
}

async function fetchSettings() {
    const settingsDoc = await refs.settings.doc('mealCycle').get();
    if (settingsDoc.exists) {
        return settingsDoc.data().startDate.toDate();
    }
    return new Date('2024-01-01');
}

async function fetchAllRecipes() {
    const recipesSnap = await refs.recipes.get();
    return recipesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

async function getMeal(dateStr) {
    const mealDoc = await refs.meals.doc(dateStr).get();
    return mealDoc.data() || {};
}

async function getTasksForDate(dateStr) {
    return await refs.tasks.where('dueDate', '==', dateStr).where('completed', '==', false).get();
}

async function saveEvent(eventData, eventId) {
    if (eventId) {
        await refs.events.doc(eventId).update(eventData);
    } else {
        await refs.events.add(eventData);
    }
}

async function deleteEvent(eventId) {
    await refs.events.doc(eventId).delete();
}

async function getEvent(eventId) {
    return await refs.events.doc(eventId).get();
}

async function updateMeal(date, mealType, data) {
    const mealKey = mealType.toLowerCase();
    const update = { [mealKey]: data };
    await refs.meals.doc(date).set(update, { merge: true });
}

async function removeMeal(date, mealType) {
    const mealKey = mealType.toLowerCase();
    const update = { [mealKey]: null };
    await refs.meals.doc(date).set(update, { merge: true });
}

async function saveRecipe(recipeData, recipeId) {
    const docRef = recipeId ? refs.recipes.doc(recipeId) : refs.recipes.doc();
    await docRef.set(recipeData, { merge: true });
}

async function deleteRecipe(recipeId) {
    await refs.recipes.doc(recipeId).delete();
}

async function addTask(taskData) {
    await refs.tasks.add(taskData);
}

async function addGroceryItem(itemName) {
    await refs.groceries.add({ name: itemName, completed: false, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
}

async function generateAndSaveWeeklyGroceryList(allRecipes, cycleStartDate, RECURRING_ITEMS) {
    // This function is quite large and contains business logic.
    // For this refactoring, we'll keep it here, but a future improvement
    // could be to separate the logic from the direct DB interaction.
    const ingredientMap = new Map();
    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(startDate.getDate() + 7);

    const parseQuantity = (qte) => {
        if (!qte) return 0;
        if (String(qte).includes('/')) {
            const parts = qte.split('/');
            return parseFloat(parts[0]) / parseFloat(parts[1]);
        }
        return parseFloat(String(qte).replace(',', '.'));
    };

    const normalizeName = (name) => {
        let lower = name.toLowerCase().trim();
        if (lower.endsWith('s') || lower.endsWith('x')) {
            lower = lower.slice(0, -1);
        }
        return lower;
    };

    const addIngredient = (item) => {
        const normalized = normalizeName(item.nom);
        const quantity = parseQuantity(item.qte);

        if (ingredientMap.has(normalized)) {
            const existing = ingredientMap.get(normalized);
            if (typeof quantity === 'number' && !isNaN(quantity)) {
                existing.total += quantity;
            }
        } else {
            ingredientMap.set(normalized, {
                total: quantity,
                unit: item.unite || '',
                originalName: item.nom
            });
        }
    };

    const addTextIngredient = (text) => {
        const normalized = normalizeName(text);
        if (!ingredientMap.has(normalized)) {
            ingredientMap.set(normalized, {
                total: 0, unit: '', originalName: text
            });
        }
    };

    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split('T')[0];
        const current = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0);

        const manualDoc = await refs.meals.doc(dateStr).get();
        const manual = manualDoc.data() || {};

        const diffDays = Math.floor((current - cycleStartDate) / (1000 * 3600 * 24));
        const week = (Math.floor(diffDays / 7) % 3) + 1;
        const dayName = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'][current.getDay()];

        for (const repas of ['Déjeuner', 'Souper']) {
            const mealTypeLower = repas.toLowerCase();
            const manualMeal = manual ? manual[mealTypeLower] : undefined;
            const autoMeal = allRecipes.find(r => r.Semaine == week && r.Jour === dayName && r.Repas === repas);
            const mealToConsider = manualMeal !== undefined ? manualMeal : (autoMeal ? { recipeId: autoMeal.id } : null);

            if (mealToConsider && mealToConsider.recipeId) {
                const recipe = allRecipes.find(r => r.id === mealToConsider.recipeId);
                if (recipe && recipe.Ingrédients) {
                     try {
                        let ingredients = JSON.parse(recipe.Ingrédients);
                        if (Array.isArray(ingredients)) {
                            ingredients.forEach(ing => {
                                if (ing.nom) addIngredient(ing);
                            });
                        }
                    } catch (e) {
                        String(recipe.Ingrédients).split('\n').map(i => i.trim()).filter(Boolean).forEach(i => addTextIngredient(i));
                    }
                }
            }
        }
    }

    RECURRING_ITEMS.forEach(item => addTextIngredient(item));

    const finalList = Array.from(ingredientMap.values()).map(item => {
        if (item.total > 0) {
            const displayQty = Math.round(item.total * 100) / 100;
            return [displayQty, item.unit, item.originalName].filter(Boolean).join(' ');
        }
        return item.originalName;
    }).sort((a, b) => a.localeCompare(b));

    const batch = db.batch();
    const existingGroceries = await refs.groceries.get();
    existingGroceries.forEach(doc => batch.delete(doc.ref));

    finalList.forEach(name => {
        const newItemRef = refs.groceries.doc();
        batch.set(newItemRef, { name, completed: false, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
    });

    await batch.commit();
}


export {
    refs,
    processAndUploadCSV,
    fetchSettings,
    fetchAllRecipes,
    getMeal,
    getTasksForDate,
    saveEvent,
    deleteEvent,
    getEvent,
    updateMeal,
    removeMeal,
    saveRecipe,
    deleteRecipe,
    addTask,
    addGroceryItem,
    generateAndSaveWeeklyGroceryList
};